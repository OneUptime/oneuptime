import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a public submission turns into (FormService.submitPublicForm and the
 * target handlers behind it).
 *
 * A stranger's request becomes an incident that pages on-call, or a
 * maintenance event, so every test here pins exactly what reaches
 * IncidentService.create or ScheduledMaintenanceService.create - field by
 * field, with nothing extra - and what happens around it:
 *
 *   - the checks, in order: the link, the captcha, the answers, what the
 *     record needs (a severity; an end after the start), then the form's
 *     hourly ceiling, spent only by a submission about to be created;
 *   - the record: the form's project whatever the body says, the answers
 *     where the form's questions put them, the On Submit settings and the
 *     incident template filling in the rest, never on a status page unless
 *     the form says so, and the owners handed to the create;
 *   - nothing the submitter wrote acting on its own: mentions, images and
 *     diagrams are broken before anything is stored;
 *   - afterwards: the submission recorded and a private note left - each
 *     failure logged, never thrown, because the record already stands;
 *   - the answer: the record's number and the form's thank-you message.
 *
 * Only the database, the captcha provider and the rate limiter's counter
 * are stubbed.
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import FormRateLimit, {
  FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  FormCeilingException,
} from "../../../Server/Middleware/FormRateLimit";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FormService, {
  FORM_NOT_AVAILABLE_MESSAGE,
  FORM_SUBMIT_FAILED_MESSAGE,
  neutralizeFormAnswers,
} from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceCustomFieldService from "../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceInternalNoteService from "../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import { FORM_NO_SEVERITY_MESSAGE } from "../../../Server/Utils/Form/IncidentFormTarget";
import logger from "../../../Server/Utils/Logger";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServerException from "../../../Types/Exception/ServerException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import {
  BuiltPublicForm,
  PublicFormSubmissionResult,
  buildPublicForm,
} from "../../../Types/Form/FormPublic";
import { FormSubmissionAnswer } from "../../../Types/Form/FormSubmissionAnswer";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  neutralizeChatControlSequences,
  neutralizeUntrustedMarkdown,
  neutralizeUntrustedPlainText,
} from "../../../Utils/Markdown/UntrustedMarkdown";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: string = "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f02";
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CLIENT_IP: string = "203.0.113.7";

const FORM_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const CHOSEN_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f2";
const TEMPLATE_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const API_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000f1";
const WEB_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000f2";
const GONE_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000f3";
const LABEL_ID: string = "c2000000-0000-4000-8000-0000000000f1";
const POLICY_ID: string = "c3000000-0000-4000-8000-0000000000f1";
const TEAM_ID: string = "c4000000-0000-4000-8000-0000000000f1";
const TEMPLATE_TEAM_ID: string = "c4000000-0000-4000-8000-0000000000f2";
const MEMBER_USER_ID: string = "c5000000-0000-4000-8000-0000000000f1";
const STRANGER_USER_ID: string = "c5000000-0000-4000-8000-0000000000f2";
const TEMPLATE_USER_ID: string = "c5000000-0000-4000-8000-0000000000f3";
const STATUS_PAGE_ID: string = "c6000000-0000-4000-8000-0000000000f1";
const OTHER_STATUS_PAGE_ID: string = "c6000000-0000-4000-8000-0000000000f2";
const REGION_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const NOTES_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f2";
const TICKET_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f3";
const INCIDENT_ID: string = "e0000000-0000-4000-8000-0000000000f1";
const EVENT_ID: string = "e0000000-0000-4000-8000-0000000000f2";

/*
 * The project's records, by the service that owns them: what exists, and
 * so what the project-scoped lookups find.
 */
const PROJECT_RECORDS: Map<unknown, Set<string>> = new Map();

function projectHas(service: unknown, ids: Array<string>): void {
  PROJECT_RECORDS.set(service, new Set(ids));
}

// What every incident form here asks.
const INCIDENT_FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "What is wrong?",
    isRequired: true,
  },
  {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Description",
    isRequired: false,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "incidentSeverityId",
    label: "How bad is it?",
    isRequired: false,
  },
  {
    id: "monitors",
    source: FormFieldSource.TargetField,
    targetField: "monitors",
    label: "Affected Monitors",
    isRequired: false,
    allowedOptionIds: [API_MONITOR_ID, WEB_MONITOR_ID],
  },
  {
    id: "impact",
    source: FormFieldSource.TargetField,
    targetField: "impactStartedAt",
    label: "When did it start?",
    isRequired: false,
  },
  {
    id: "region",
    source: FormFieldSource.TargetCustomField,
    customFieldId: REGION_FIELD_ID,
    label: "Region",
    isRequired: true,
  },
  {
    id: "notes",
    source: FormFieldSource.TargetCustomField,
    customFieldId: NOTES_FIELD_ID,
    label: "Notes",
    isRequired: false,
  },
  {
    id: "office",
    source: FormFieldSource.Question,
    type: CustomFieldType.Dropdown,
    dropdownOptions: "Berlin\nLondon",
    label: "Which office?",
    isRequired: false,
  },
  {
    id: "steps",
    source: FormFieldSource.Question,
    type: CustomFieldType.LongText,
    label: "Steps to reproduce",
    isRequired: false,
  },
  {
    id: "name",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Name,
    label: "Your Name",
    isRequired: false,
  },
  {
    id: "email",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Email,
    label: "Your Email",
    isRequired: false,
  },
];

const INCIDENT_SETTINGS: JSONObject = {
  incidentSeverityId: FORM_SEVERITY_ID,
  incidentTemplateId: TEMPLATE_ID,
  monitorIds: [WEB_MONITOR_ID, GONE_MONITOR_ID],
  labelIds: [LABEL_ID],
  onCallDutyPolicyIds: [POLICY_ID],
  ownerUserIds: [MEMBER_USER_ID, STRANGER_USER_ID],
  ownerTeamIds: [TEAM_ID],
};

const MAINTENANCE_FIELDS: Array<FormField> = [
  ...getDefaultFormFields(FormTargetType.ScheduledMaintenance).map(
    (field: FormField, index: number): FormField => {
      return {
        ...field,
        id: ["title", "description", "starts", "ends", "name", "email"][index]!,
      };
    },
  ),
  {
    id: "pages",
    source: FormFieldSource.TargetField,
    targetField: "statusPages",
    label: "Which status pages?",
    isRequired: false,
    allowedOptionIds: [STATUS_PAGE_ID, OTHER_STATUS_PAGE_ID],
  },
  {
    id: "ticket",
    source: FormFieldSource.TargetCustomField,
    customFieldId: TICKET_FIELD_ID,
    label: "Change Ticket",
    isRequired: false,
  },
];

function buildIncidentForm(data: Partial<Form> = {}): Form {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Incident;
  form.fields = INCIDENT_FIELDS as unknown as JSONArray;
  form.targetSettings = { ...INCIDENT_SETTINGS };
  form.successMessage = "Thanks - we are on it.";
  form.ipWhitelist = "";
  Object.assign(form, data);
  return form;
}

function buildMaintenanceForm(data: Partial<Form> = {}): Form {
  return buildIncidentForm({
    name: "Request Maintenance",
    targetType: FormTargetType.ScheduledMaintenance,
    fields: MAINTENANCE_FIELDS as unknown as JSONArray,
    targetSettings: {
      monitorIds: [API_MONITOR_ID],
      statusPageIds: [STATUS_PAGE_ID],
      labelIds: [LABEL_ID],
      ownerUserIds: [MEMBER_USER_ID],
      ownerTeamIds: [TEAM_ID],
    },
    successMessage: "We will review it.",
    ...data,
  });
}

// Every required question answered, and a few optional ones.
const INCIDENT_ANSWERS: JSONObject = {
  title: "Checkout is down",
  description: "Every order fails.",
  severity: CHOSEN_SEVERITY_ID,
  monitors: [API_MONITOR_ID],
  impact: "2026-10-02T09:30:00.000Z",
  region: "EU",
  office: "Berlin",
  steps: "1. Add to cart\n2. Pay",
  name: "Jane Doe",
  email: "Jane@Example.com",
};

const MAINTENANCE_ANSWERS: JSONObject = {
  title: "Upgrade the database",
  description: "Postgres 17.",
  starts: "2026-10-10T02:00:00.000Z",
  ends: "2026-10-10T04:00:00.000Z",
  pages: [OTHER_STATUS_PAGE_ID],
  ticket: "CHG-1234",
  name: "Sam Ops",
  email: "sam@example.com",
};

let storedForm: Form | null = null;
let incidentCreate: MockedFn;
let eventCreate: MockedFn;
let submissionCreate: MockedFn;
let incidentNoteCreate: MockedFn;
let eventNoteCreate: MockedFn;
let reserveCeiling: MockedFn;
let verifyCaptcha: MockedFn;
let templateSeverityId: string | undefined;
let templateOwnerUserIds: Array<string>;
let templateOwnerTeamIds: Array<string>;

function stubProjectLookup(service: unknown): void {
  jest
    .spyOn(service as DatabaseService<never>, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { _id?: unknown; projectId?: unknown };
    }): Promise<unknown> => {
      const id: string = String(findBy.query._id || "").toLowerCase();
      const projectId: string = String(findBy.query.projectId || "");

      if (
        projectId !== PROJECT_ID.toString() ||
        !PROJECT_RECORDS.get(service)?.has(id)
      ) {
        return null;
      }

      if (service === IncidentTemplateService) {
        const template: IncidentTemplate = new IncidentTemplate();
        template._id = id;

        if (templateSeverityId) {
          template.incidentSeverityId = new ObjectID(templateSeverityId);
        }

        return template;
      }

      return { _id: id, id: new ObjectID(id) };
    }) as never);
}

function incidentCustomField(
  id: string,
  name: string,
  type: CustomFieldType,
  dropdownOptions?: string,
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field._id = id;
  field.name = name;
  field.customFieldType = type;

  if (dropdownOptions) {
    field.dropdownOptions = dropdownOptions;
  }

  return field;
}

beforeEach(() => {
  storedForm = buildIncidentForm();
  templateSeverityId = undefined;
  templateOwnerUserIds = [TEMPLATE_USER_ID];
  templateOwnerTeamIds = [TEMPLATE_TEAM_ID];

  projectHas(IncidentSeverityService, [FORM_SEVERITY_ID, CHOSEN_SEVERITY_ID]);
  projectHas(IncidentTemplateService, [TEMPLATE_ID]);
  projectHas(MonitorService, [API_MONITOR_ID, WEB_MONITOR_ID]);
  projectHas(LabelService, [LABEL_ID]);
  projectHas(OnCallDutyPolicyService, [POLICY_ID]);
  projectHas(TeamService, [TEAM_ID]);
  projectHas(StatusPageService, [STATUS_PAGE_ID, OTHER_STATUS_PAGE_ID]);

  for (const service of [
    IncidentSeverityService,
    IncidentTemplateService,
    MonitorService,
    LabelService,
    OnCallDutyPolicyService,
    TeamService,
    StatusPageService,
  ]) {
    stubProjectLookup(service);
  }

  jest.spyOn(FormService, "findOneBy").mockImplementation((async (findBy: {
    query: { shareKey?: ObjectID };
  }): Promise<Form | null> => {
    return storedForm &&
      findBy.query.shareKey?.toString() === storedForm.shareKey?.toString()
      ? storedForm
      : null;
  }) as never);

  jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true as never);

  // The records a question offers, as the public form lists them.
  jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([
    Object.assign(new IncidentSeverity(), {
      _id: FORM_SEVERITY_ID,
      name: "Minor",
    }),
    Object.assign(new IncidentSeverity(), {
      _id: CHOSEN_SEVERITY_ID,
      name: "Critical",
    }),
  ] as never);
  jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue([
      Object.assign(new Monitor(), { _id: API_MONITOR_ID, name: "API" }),
      Object.assign(new Monitor(), { _id: WEB_MONITOR_ID, name: "Website" }),
    ] as never);
  jest.spyOn(StatusPageService, "findBy").mockResolvedValue([
    Object.assign(new StatusPage(), { _id: STATUS_PAGE_ID, name: "Main" }),
    Object.assign(new StatusPage(), {
      _id: OTHER_STATUS_PAGE_ID,
      name: "Partners",
    }),
  ] as never);
  jest
    .spyOn(LabelService, "findBy")
    .mockResolvedValue([
      Object.assign(new Label(), { _id: LABEL_ID, name: "customer-report" }),
    ] as never);

  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([
      incidentCustomField(
        REGION_FIELD_ID,
        "Region",
        CustomFieldType.Dropdown,
        "EU\nUS",
      ),
      incidentCustomField(NOTES_FIELD_ID, "Notes", CustomFieldType.Markdown),
    ] as never);

  jest
    .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
    .mockResolvedValue([
      Object.assign(new ScheduledMaintenanceCustomField(), {
        _id: TICKET_FIELD_ID,
        name: "Change Ticket",
        customFieldType: CustomFieldType.Text,
      }),
    ] as never);

  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation((async (data: {
      userIds: Array<string | ObjectID>;
    }): Promise<Array<ObjectID>> => {
      return data.userIds
        .map((id: string | ObjectID): string => {
          return id.toString();
        })
        .filter((id: string): boolean => {
          return id !== STRANGER_USER_ID;
        })
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        });
    }) as never);

  jest
    .spyOn(IncidentTemplateOwnerUserService, "findBy")
    .mockImplementation((async (): Promise<
      Array<IncidentTemplateOwnerUser>
    > => {
      return templateOwnerUserIds.map((id: string) => {
        return Object.assign(new IncidentTemplateOwnerUser(), {
          userId: new ObjectID(id),
        });
      });
    }) as never);
  jest
    .spyOn(IncidentTemplateOwnerTeamService, "findBy")
    .mockImplementation((async (): Promise<
      Array<IncidentTemplateOwnerTeam>
    > => {
      return templateOwnerTeamIds.map((id: string) => {
        return Object.assign(new IncidentTemplateOwnerTeam(), {
          teamId: new ObjectID(id),
        });
      });
    }) as never);

  incidentCreate = jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.incidentNumber = 42;
      incident.incidentNumberWithPrefix = "INC-42";
      return incident;
    }) as never) as unknown as MockedFn;

  eventCreate = jest
    .spyOn(ScheduledMaintenanceService, "create")
    .mockImplementation((async (): Promise<ScheduledMaintenance> => {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event._id = EVENT_ID;
      event.scheduledMaintenanceNumber = 7;
      return event;
    }) as never) as unknown as MockedFn;

  submissionCreate = jest
    .spyOn(FormSubmissionService, "create")
    .mockImplementation((async (createBy: { data: FormSubmission }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  incidentNoteCreate = jest
    .spyOn(IncidentInternalNoteService, "create")
    .mockImplementation((async (createBy: { data: IncidentInternalNote }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  eventNoteCreate = jest
    .spyOn(ScheduledMaintenanceInternalNoteService, "create")
    .mockImplementation((async (createBy: {
      data: ScheduledMaintenanceInternalNote;
    }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  reserveCeiling = jest
    .spyOn(FormRateLimit, "reserveFormSubmission")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
  verifyCaptcha = jest
    .spyOn(CaptchaUtil, "verifyCaptcha")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function submit(
  answers: unknown,
  extra: { shareKey?: string; captchaToken?: string; clientIp?: string } = {},
): Promise<PublicFormSubmissionResult> {
  return FormService.submitPublicForm({
    shareKey: extra.shareKey || SHARE_KEY,
    request: {
      data: { answers: answers as JSONObject },
      captchaToken: extra.captchaToken,
    },
    clientIp: extra.clientIp || CLIENT_IP,
    captchaRemoteIp: extra.clientIp || CLIENT_IP,
  });
}

async function refusal(
  promise: Promise<unknown>,
): Promise<Exception | undefined> {
  try {
    await promise;
  } catch (err) {
    return err as Exception;
  }

  return undefined;
}

function createdIncident(): Incident {
  expect(incidentCreate).toHaveBeenCalledTimes(1);
  return (incidentCreate.mock.calls[0]![0] as { data: Incident }).data;
}

function incidentCreateBy(): {
  data: Incident;
  props: JSONObject;
  miscDataProps?: JSONObject;
} {
  return incidentCreate.mock.calls[0]![0] as never;
}

function createdEvent(): ScheduledMaintenance {
  expect(eventCreate).toHaveBeenCalledTimes(1);
  return (eventCreate.mock.calls[0]![0] as { data: ScheduledMaintenance }).data;
}

function idsOf(records: Array<{ _id?: string }> | undefined): Array<string> {
  return (records || []).map((record: { _id?: string }): string => {
    return String(record._id);
  });
}

function recordedSubmission(): FormSubmission {
  expect(submissionCreate).toHaveBeenCalledTimes(1);
  return (submissionCreate.mock.calls[0]![0] as { data: FormSubmission }).data;
}

function nothingCreated(): void {
  expect(incidentCreate).not.toHaveBeenCalled();
  expect(eventCreate).not.toHaveBeenCalled();
  expect(submissionCreate).not.toHaveBeenCalled();
}

describe("submitPublicForm - the incident a form declares", () => {
  test("declares it in the form's project, as root, from the answers and the settings", async () => {
    await submit(INCIDENT_ANSWERS);

    const incident: Incident = createdIncident();

    expect(incident.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incident.title).toBe("Checkout is down");
    expect(incident.description).toBe("Every order fails.");
    expect(incident.incidentSeverityId?.toString()).toBe(CHOSEN_SEVERITY_ID);
    expect(incident.createdIncidentTemplateId).toBe(TEMPLATE_ID);
    expect(incident.impactStartedAt).toEqual(
      new Date("2026-10-02T09:30:00.000Z"),
    );
    // The submitter's choice, together with what the settings attach.
    expect(idsOf(incident.monitors)).toEqual([API_MONITOR_ID, WEB_MONITOR_ID]);
    expect(idsOf(incident.labels)).toEqual([LABEL_ID]);
    expect(idsOf(incident.onCallDutyPolicies)).toEqual([POLICY_ID]);
    expect(incident.customFields).toEqual({ Region: "EU" });
    expect(incidentCreateBy().props).toEqual({ isRoot: true });
  });

  test("keeps the incident off every status page, and quiet to their subscribers", async () => {
    await submit(INCIDENT_ANSWERS);

    expect(createdIncident().isVisibleOnStatusPage).toBe(false);
    expect(
      createdIncident().shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(false);
  });

  test("never sets a state, so IncidentService's template branch runs; names no creating user", async () => {
    await submit(INCIDENT_ANSWERS);

    expect(createdIncident().currentIncidentStateId).toBeUndefined();
    expect(createdIncident().createdByUserId).toBeUndefined();
  });

  test("leaves out what was not answered, so the template can fill it in", async () => {
    await submit({ title: "Down", region: "US" });

    const incident: Incident = createdIncident();

    expect(incident.description).toBeUndefined();
    expect(incident.impactStartedAt).toBeUndefined();
    // Only what the settings always attach.
    expect(idsOf(incident.monitors)).toEqual([WEB_MONITOR_ID]);
  });

  test("ignores everything in the body the form does not ask for", async () => {
    await submit({
      ...INCIDENT_ANSWERS,
      projectId: OTHER_PROJECT_ID,
      isVisibleOnStatusPage: true,
      currentIncidentStateId: FORM_SEVERITY_ID,
      createdByUserId: MEMBER_USER_ID,
    });

    const incident: Incident = createdIncident();

    expect(incident.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incident.isVisibleOnStatusPage).toBe(false);
    expect(incident.currentIncidentStateId).toBeUndefined();
    expect(incident.createdByUserId).toBeUndefined();
  });

  test("a record the settings name that was deleted since is skipped; the rest still applies", async () => {
    await submit(INCIDENT_ANSWERS);

    expect(idsOf(createdIncident().monitors)).not.toContain(GONE_MONITOR_ID);
  });

  test("the owners - the form's members and the template's - are handed to the create, and told", async () => {
    await submit(INCIDENT_ANSWERS);

    const misc: JSONObject = incidentCreateBy().miscDataProps!;

    expect(
      (misc["ownerUsers"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MEMBER_USER_ID, TEMPLATE_USER_ID]);
    expect(
      (misc["ownerTeams"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([TEAM_ID, TEMPLATE_TEAM_ID]);
    expect(misc["notifyOwners"]).toBe(true);
  });

  test("an owner who is no longer a member of the project is left out", async () => {
    await submit(INCIDENT_ANSWERS);

    const owners: Array<string> = (
      incidentCreateBy().miscDataProps!["ownerUsers"] as Array<ObjectID>
    ).map((id: ObjectID): string => {
      return id.toString();
    });

    expect(owners).not.toContain(STRANGER_USER_ID);
  });

  test("hands no owners, and no notify, when there are none", async () => {
    storedForm = buildIncidentForm({
      targetSettings: { incidentSeverityId: FORM_SEVERITY_ID },
    });

    await submit(INCIDENT_ANSWERS);

    expect(incidentCreateBy().miscDataProps).toBeUndefined();
  });

  test("a failure reading the template's owners is logged, and the incident is declared with the form's own", async () => {
    (
      IncidentTemplateOwnerUserService.findBy as unknown as MockedFn
    ).mockRejectedValue(new Error("connection reset"));

    await submit(INCIDENT_ANSWERS);

    expect(
      (incidentCreateBy().miscDataProps!["ownerUsers"] as Array<ObjectID>).map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([MEMBER_USER_ID]);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("submitPublicForm - the incident's severity", () => {
  test("the submitter's choice, when the form asks", async () => {
    await submit(INCIDENT_ANSWERS);

    expect(createdIncident().incidentSeverityId?.toString()).toBe(
      CHOSEN_SEVERITY_ID,
    );
  });

  test("the form's own, when the submitter chose none", async () => {
    await submit({ ...INCIDENT_ANSWERS, severity: "" });

    expect(createdIncident().incidentSeverityId?.toString()).toBe(
      FORM_SEVERITY_ID,
    );
  });

  test("a choice the question does not offer is refused, and nothing is declared", async () => {
    const error: Exception | undefined = await refusal(
      submit({ ...INCIDENT_ANSWERS, severity: TEMPLATE_ID }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "How bad is it? must be one of the options the form lists.",
    );
    nothingCreated();
  });

  test("left to the template when the form's own was deleted and the template sets one", async () => {
    projectHas(IncidentSeverityService, [CHOSEN_SEVERITY_ID]);
    templateSeverityId = CHOSEN_SEVERITY_ID;

    await submit({ ...INCIDENT_ANSWERS, severity: "" });

    expect(createdIncident().incidentSeverityId).toBeUndefined();
    expect(createdIncident().createdIncidentTemplateId).toBe(TEMPLATE_ID);
  });

  test("with no severity anywhere, the submission is refused with words the submitter can pass on", async () => {
    projectHas(IncidentSeverityService, [CHOSEN_SEVERITY_ID]);
    templateSeverityId = undefined;

    const error: Exception | undefined = await refusal(
      submit({ ...INCIDENT_ANSWERS, severity: "" }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(FORM_NO_SEVERITY_MESSAGE);
    nothingCreated();
    // A refusal never spends the form's hourly allowance.
    expect(reserveCeiling).not.toHaveBeenCalled();
  });

  test("a deleted template is not declared from", async () => {
    projectHas(IncidentTemplateService, []);

    await submit(INCIDENT_ANSWERS);

    expect(createdIncident().createdIncidentTemplateId).toBeUndefined();
  });
});

describe("submitPublicForm - the title", () => {
  test("the answer, on one line", async () => {
    await submit({ ...INCIDENT_ANSWERS, title: "  Checkout\n is   down " });

    expect(createdIncident().title).toBe("Checkout is down");
  });

  test("the default title when the form does not ask, or it is left empty", async () => {
    storedForm = buildIncidentForm({
      fields: INCIDENT_FIELDS.map((field: FormField): FormField => {
        return field.id === "title" ? { ...field, isRequired: false } : field;
      }) as unknown as JSONArray,
      targetSettings: { ...INCIDENT_SETTINGS, defaultTitle: "Customer report" },
    });

    await submit({ ...INCIDENT_ANSWERS, title: "" });

    expect(createdIncident().title).toBe("Customer report");
  });

  test("else the form's name", async () => {
    storedForm = buildIncidentForm({
      fields: INCIDENT_FIELDS.filter((field: FormField): boolean => {
        return field.id !== "title";
      }) as unknown as JSONArray,
    });

    await submit(INCIDENT_ANSWERS);

    expect(createdIncident().title).toBe("Report a Problem");
  });

  test("a title that no longer fits once its mentions are broken is refused, and nothing is declared", async () => {
    // Exactly as long as a title may be, until "<!" gets its invisible character.
    const title: string = `${"x".repeat(493)}<!here>`;

    expect(title.length).toBe(500);

    const error: Exception | undefined = await refusal(
      submit({ ...INCIDENT_ANSWERS, title }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "What is wrong? cannot be more than 500 characters.",
    );
    nothingCreated();
  });
});

describe("submitPublicForm - nothing the submitter wrote acts on its own", () => {
  const TITLE: string = "Down <!channel> ![x](https://evil.example/x.png)";
  const DESCRIPTION: string =
    "See ![status](https://evil.example/status.png) <!here>\n\n```mermaid\ngraph TD;A-->B\n```";
  const NOTES: string = "![pixel](https://evil.example/p.gif) <@U0123ABC>";
  const STEPS: string = "Ping <!subteam^S123> then retry";

  test("the title, description, Markdown and text answers lose their mentions, images and diagrams", async () => {
    await submit({
      ...INCIDENT_ANSWERS,
      title: TITLE,
      description: DESCRIPTION,
      notes: NOTES,
      steps: STEPS,
    });

    const incident: Incident = createdIncident();

    expect(incident.title).toBe(neutralizeUntrustedPlainText(TITLE));
    expect(incident.title).not.toBe(TITLE);
    expect(incident.description).toBe(neutralizeUntrustedMarkdown(DESCRIPTION));
    expect(incident.description).not.toBe(DESCRIPTION);
    // The diagram is code now, and the image a link the renderers show as text.
    expect(incident.description).toContain("```text");
    expect(incident.description).not.toMatch(/(^|[^\\])!\[status\]/);
    expect((incident.customFields as JSONObject)["Notes"]).toBe(
      neutralizeUntrustedMarkdown(NOTES),
    );

    // A text answer of the form's own lands on the private note, broken.
    const note: string = (
      incidentNoteCreate.mock.calls[0]![0] as { data: IncidentInternalNote }
    ).data.note!;

    expect(note).not.toContain("<!subteam");
    expect(neutralizeChatControlSequences(STEPS)).not.toBe(STEPS);
  });

  test("choices, dates and the submitter's details are stored as given", async () => {
    await submit(INCIDENT_ANSWERS);

    expect((createdIncident().customFields as JSONObject)["Region"]).toBe("EU");
    expect(recordedSubmission().submitterName).toBe("Jane Doe");
  });

  test("ordinary text is stored exactly as typed", async () => {
    await submit({
      ...INCIDENT_ANSWERS,
      description:
        "Orders fail with **500** - see [the log](https://logs.example/1).",
    });

    expect(createdIncident().description).toBe(
      "Orders fail with **500** - see [the log](https://logs.example/1).",
    );
  });
});

describe("neutralizeFormAnswers", () => {
  const BUILT: BuiltPublicForm = buildPublicForm({
    form: {
      name: "F",
      fields: INCIDENT_FIELDS,
      targetType: FormTargetType.Incident,
    },
    customFields: [
      {
        id: REGION_FIELD_ID,
        name: "Region",
        customFieldType: "Dropdown",
        dropdownOptions: "EU",
      },
      { id: NOTES_FIELD_ID, name: "Notes", customFieldType: "Markdown" },
    ],
    recordOptions: {},
    isCaptchaRequired: false,
  });

  test("leaves the submitter's name and address, and choices, alone", () => {
    const neutralized: JSONObject = neutralizeFormAnswers({
      answers: {
        name: "<!channel> Jane",
        email: "jane@example.com",
        region: "EU",
      },
      fields: BUILT.form.fields,
      bindings: BUILT.bindings,
    });

    expect(neutralized).toEqual({
      name: "<!channel> Jane",
      email: "jane@example.com",
      region: "EU",
    });
  });

  test("breaks a title as plain text, Markdown as Markdown, and text answers' mentions", () => {
    const neutralized: JSONObject = neutralizeFormAnswers({
      answers: {
        title: "![x](https://e/x.png)",
        notes: "![x](https://e/x.png)",
        steps: "<!channel>",
      },
      fields: BUILT.form.fields,
      bindings: BUILT.bindings,
    });

    expect(neutralized["title"]).toBe(
      neutralizeUntrustedPlainText("![x](https://e/x.png)"),
    );
    expect(neutralized["notes"]).toBe(
      neutralizeUntrustedMarkdown("![x](https://e/x.png)"),
    );
    expect(neutralized["steps"]).toBe(
      neutralizeChatControlSequences("<!channel>"),
    );
  });

  test("keeps only answers to the form's questions, and never mutates what it was given", () => {
    const answers: JSONObject = Object.freeze({
      title: "<!here>",
      unknown: "<!here>",
    }) as JSONObject;

    const neutralized: JSONObject = neutralizeFormAnswers({
      answers,
      fields: BUILT.form.fields,
      bindings: BUILT.bindings,
    });

    expect(Object.keys(neutralized)).toEqual(["title"]);
    expect(answers["title"]).toBe("<!here>");
  });
});

describe("submitPublicForm - the submission record and the private note", () => {
  test("the record names the form, what it created and the submitter, the email lowercased", async () => {
    await submit(INCIDENT_ANSWERS);

    const submission: FormSubmission = recordedSubmission();

    expect(submission.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(submission.formId?.toString()).toBe(FORM_ID);
    expect(submission.targetType).toBe(FormTargetType.Incident);
    expect(submission.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(submission.scheduledMaintenanceId).toBeUndefined();
    expect(submission.submitterName).toBe("Jane Doe");
    expect(submission.submitterEmail?.toString()).toBe("jane@example.com");
    expect(
      (submissionCreate.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("keeps every answer, with the words to show for it", async () => {
    await submit(INCIDENT_ANSWERS);

    const answers: Array<FormSubmissionAnswer> = recordedSubmission()
      .answers as unknown as Array<FormSubmissionAnswer>;

    const byField: Record<string, FormSubmissionAnswer> = {};

    for (const answer of answers) {
      byField[answer.fieldId] = answer;
    }

    expect(byField["severity"]).toEqual({
      fieldId: "severity",
      label: "How bad is it?",
      value: CHOSEN_SEVERITY_ID,
      displayValue: "Critical",
    });
    expect(byField["monitors"]!.displayValue).toBe("API");
    expect(byField["office"]!.displayValue).toBe("Berlin");
    expect(byField["email"]!.value).toBe("jane@example.com");
  });

  test("an anonymous submission records no submitter", async () => {
    await submit({ title: "Down", region: "EU" });

    expect(recordedSubmission().submitterName).toBeUndefined();
    expect(recordedSubmission().submitterEmail).toBeUndefined();
  });

  test("the private note names the form and the submitter, and lists the form's own questions only", async () => {
    await submit(INCIDENT_ANSWERS);

    const note: IncidentInternalNote = (
      incidentNoteCreate.mock.calls[0]![0] as { data: IncidentInternalNote }
    ).data;

    expect(note.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(note.note).toContain(
      "Submitted through the form **Report a Problem** by Jane Doe (<jane@example.com>).",
    );
    expect(note.note).toContain("**Which office?**  \nBerlin");
    expect(note.note).toContain(
      "**Steps to reproduce**  \n1. Add to cart  \n2. Pay",
    );
    // The answers already on the incident are not repeated.
    expect(note.note).not.toContain("What is wrong?");
    expect(note.note).not.toContain("Region");
  });

  test("an anonymous submission's note says so", async () => {
    await submit({ title: "Down", region: "EU" });

    expect(
      (incidentNoteCreate.mock.calls[0]![0] as { data: IncidentInternalNote })
        .data.note,
    ).toBe("Submitted anonymously through the form **Report a Problem**.");
  });

  test("a failure recording the submission is logged, and the note still happens", async () => {
    submissionCreate.mockRejectedValue(new Error("connection reset"));

    const result: PublicFormSubmissionResult = await submit(INCIDENT_ANSWERS);

    expect(result.reference).toBe("INC-42");
    expect(incidentNoteCreate).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a failure writing the note is logged, not thrown", async () => {
    incidentNoteCreate.mockRejectedValue(new Error("connection reset"));

    await expect(submit(INCIDENT_ANSWERS)).resolves.toEqual({
      reference: "INC-42",
      successMessage: "Thanks - we are on it.",
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("submitPublicForm - when the record cannot be created", () => {
  test("answers with a message the submitter can act on, logs the reason, and does nothing else", async () => {
    incidentCreate.mockRejectedValue(
      new Error("insert violates foreign key constraint FK_secret"),
    );

    const error: Exception | undefined = await refusal(
      submit(INCIDENT_ANSWERS),
    );

    expect(error).toBeInstanceOf(ServerException);
    expect(error?.message).toBe(FORM_SUBMIT_FAILED_MESSAGE);
    expect(error?.message).not.toContain("FK_secret");
    expect(submissionCreate).not.toHaveBeenCalled();
    expect(incidentNoteCreate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("submitPublicForm - the answer", () => {
  test("is the record's number and the form's thank-you message", async () => {
    expect(await submit(INCIDENT_ANSWERS)).toEqual({
      reference: "INC-42",
      successMessage: "Thanks - we are on it.",
    });
  });

  test("numbers a record of a project without a prefix with a #", async () => {
    incidentCreate.mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.incidentNumber = 9;
      return incident;
    }) as never);

    expect((await submit(INCIDENT_ANSWERS)).reference).toBe("#9");
  });

  test("leaves out a blank thank-you message, and a number the record came back without", async () => {
    storedForm = buildIncidentForm({ successMessage: "   " });
    incidentCreate.mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      return incident;
    }) as never);

    expect(await submit(INCIDENT_ANSWERS)).toEqual({});
  });

  test("never includes the record's id, the form's id or its project", async () => {
    const serialized: string = JSON.stringify(await submit(INCIDENT_ANSWERS));

    expect(serialized).not.toContain(INCIDENT_ID);
    expect(serialized).not.toContain(FORM_ID);
    expect(serialized).not.toContain(PROJECT_ID.toString());
  });
});

describe("submitPublicForm - the checks before anything is created", () => {
  test("an unknown link is not available", async () => {
    const error: Exception | undefined = await refusal(
      submit(INCIDENT_ANSWERS, { shareKey: OTHER_SHARE_KEY }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    nothingCreated();
  });

  test("a form not accepting submissions is not available", async () => {
    storedForm = buildIncidentForm({ isEnabled: false });

    expect(await refusal(submit(INCIDENT_ANSWERS))).toBeInstanceOf(
      NotFoundException,
    );
    nothingCreated();
  });

  test("a network the form does not allow is refused before the captcha", async () => {
    storedForm = buildIncidentForm({ ipWhitelist: "198.51.100.0/24" });
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);

    expect(await refusal(submit(INCIDENT_ANSWERS))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(verifyCaptcha).not.toHaveBeenCalled();
    nothingCreated();
  });

  test("verifies the captcha, when the instance has one, with the token and the client's address", async () => {
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);

    await submit(INCIDENT_ANSWERS, { captchaToken: "solved" });

    expect(verifyCaptcha).toHaveBeenCalledWith({
      token: "solved",
      remoteIp: CLIENT_IP,
    });
  });

  test("a failed captcha is refused before the answers are read", async () => {
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);
    verifyCaptcha.mockRejectedValue(
      new BadDataException("Captcha verification failed. Please try again."),
    );

    const error: Exception | undefined = await refusal(submit({}));

    expect(error?.message).toBe(
      "Captcha verification failed. Please try again.",
    );
    nothingCreated();
  });

  test("no captcha is verified when the instance has none, even if a token is sent", async () => {
    await submit(INCIDENT_ANSWERS, { captchaToken: "anything" });

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  test("every problem with the answers is reported at once, as one message", async () => {
    const error: Exception | undefined = await refusal(
      submit({ title: " ", email: "not-an-email", office: "Paris" }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "What is wrong? is required. Region is required. Which office? must be one of the options the form lists. Your Email is not a valid email address.",
    );
    nothingCreated();
    expect(reserveCeiling).not.toHaveBeenCalled();
  });

  test("a body without answers is every required question unanswered", async () => {
    const error: Exception | undefined = await refusal(
      FormService.submitPublicForm({
        shareKey: SHARE_KEY,
        request: { data: {} },
        clientIp: CLIENT_IP,
      }),
    );

    expect(error?.message).toBe(
      "What is wrong? is required. Region is required.",
    );
  });
});

describe("submitPublicForm - the form's hourly ceiling", () => {
  test("is spent once, for the form's link, after every check and right before the record is created", async () => {
    const order: Array<string> = [];

    reserveCeiling.mockImplementation((async (): Promise<void> => {
      order.push("ceiling");
    }) as never);
    incidentCreate.mockImplementation((async (): Promise<Incident> => {
      order.push("create");
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      return incident;
    }) as never);

    await submit(INCIDENT_ANSWERS);

    expect(order).toEqual(["ceiling", "create"]);
    expect(reserveCeiling).toHaveBeenCalledWith({ shareKey: SHARE_KEY });
  });

  test("once the hour's allowance is used, nothing is created and the refusal says when to come back", async () => {
    reserveCeiling.mockRejectedValue(new FormCeilingException(1200));

    const error: Exception | undefined = await refusal(
      submit(INCIDENT_ANSWERS),
    );

    expect(error).toBeInstanceOf(FormCeilingException);
    expect((error as FormCeilingException).retryAfterSeconds).toBe(1200);
    nothingCreated();
  });

  test("when the ceiling cannot be counted, nothing is created (503)", async () => {
    reserveCeiling.mockRejectedValue(
      new ServiceUnavailableException(FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE),
    );

    expect(await refusal(submit(INCIDENT_ANSWERS))).toBeInstanceOf(
      ServiceUnavailableException,
    );
    nothingCreated();
  });
});

describe("submitPublicForm - the scheduled maintenance event a form schedules", () => {
  beforeEach(() => {
    storedForm = buildMaintenanceForm();
  });

  test("schedules it in the form's project, as root, for the window asked, off its status pages and quiet", async () => {
    await submit(MAINTENANCE_ANSWERS);

    const event: ScheduledMaintenance = createdEvent();

    expect(event.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(event.title).toBe("Upgrade the database");
    expect(event.description).toBe("Postgres 17.");
    expect(event.startsAt).toEqual(new Date("2026-10-10T02:00:00.000Z"));
    expect(event.endsAt).toEqual(new Date("2026-10-10T04:00:00.000Z"));
    expect(idsOf(event.monitors)).toEqual([API_MONITOR_ID]);
    // The submitter's choice, together with the pages the settings name.
    expect(idsOf(event.statusPages)).toEqual([
      OTHER_STATUS_PAGE_ID,
      STATUS_PAGE_ID,
    ]);
    expect(idsOf(event.labels)).toEqual([LABEL_ID]);
    expect(event.customFields).toEqual({ "Change Ticket": "CHG-1234" });
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
    expect(event.currentScheduledMaintenanceStateId).toBeUndefined();
    expect(
      (eventCreate.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("hands its owners to the create", async () => {
    await submit(MAINTENANCE_ANSWERS);

    const misc: JSONObject = (
      eventCreate.mock.calls[0]![0] as { miscDataProps: JSONObject }
    ).miscDataProps;

    expect(
      (misc["ownerUsers"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MEMBER_USER_ID]);
    expect(
      (misc["ownerTeams"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([TEAM_ID]);
  });

  test("publishes it, and tells subscribers, only when the form's settings say so", async () => {
    storedForm = buildMaintenanceForm({
      targetSettings: { showOnStatusPages: true, notifySubscribers: true },
    });

    await submit(MAINTENANCE_ANSWERS);

    const event: ScheduledMaintenance = createdEvent();

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

  test.each([
    ["ends before it starts", "2026-10-10T01:00:00.000Z"],
    ["ends when it starts", "2026-10-10T02:00:00.000Z"],
  ])(
    "a window that %s is refused, in the form's own words, and nothing is scheduled",
    async (_label: string, ends: string) => {
      const error: Exception | undefined = await refusal(
        submit({ ...MAINTENANCE_ANSWERS, ends }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe("Ends At must be after Starts At.");
      nothingCreated();
      expect(reserveCeiling).not.toHaveBeenCalled();
    },
  );

  test("a form stored without a required start still schedules nothing without one", async () => {
    storedForm = buildMaintenanceForm({
      fields: MAINTENANCE_FIELDS.map((field: FormField): FormField => {
        return field.id === "starts"
          ? { ...field, label: "From", isRequired: false }
          : field;
      }) as unknown as JSONArray,
    });

    const error: Exception | undefined = await refusal(
      submit({ ...MAINTENANCE_ANSWERS, starts: "" }),
    );

    expect(error?.message).toBe("From is required.");
    nothingCreated();
  });

  test("records the submission against the event, and leaves its note on the event", async () => {
    const result: PublicFormSubmissionResult =
      await submit(MAINTENANCE_ANSWERS);

    expect(result).toEqual({
      reference: "#7",
      successMessage: "We will review it.",
    });

    const submission: FormSubmission = recordedSubmission();

    expect(submission.targetType).toBe(FormTargetType.ScheduledMaintenance);
    expect(submission.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
    expect(submission.incidentId).toBeUndefined();

    const note: ScheduledMaintenanceInternalNote = (
      eventNoteCreate.mock.calls[0]![0] as {
        data: ScheduledMaintenanceInternalNote;
      }
    ).data;

    expect(note.scheduledMaintenanceId?.toString()).toBe(EVENT_ID);
    expect(note.note).toBe(
      "Submitted through the form **Request Maintenance** by Sam Ops (<sam@example.com>).",
    );
    expect(incidentNoteCreate).not.toHaveBeenCalled();
  });

  test("a status page the question does not offer is refused", async () => {
    const error: Exception | undefined = await refusal(
      submit({ ...MAINTENANCE_ANSWERS, pages: [TEMPLATE_ID] }),
    );

    expect(error?.message).toBe(
      "Which status pages? must be chosen from the options the form lists.",
    );
    nothingCreated();
  });
});

/*
 * Templates and hidden questions: a hidden question is never asked, and the
 * request is never read for it. The server answers it from the template the
 * submission names - and only from that one - checked as an answer to the
 * question, made safe to show like every other answer.
 */
describe("submitPublicForm - hidden questions, answered from a template", () => {
  // The description and the Notes custom field are hidden: templates write them.
  const HIDDEN_FIELDS: Array<FormField> = INCIDENT_FIELDS.map(
    (field: FormField): FormField => {
      if (field.id === "description" || field.id === "notes") {
        return { ...field, isRequired: false, isHidden: true };
      }

      if (field.id === "region") {
        // Hidden, so not required; its template answer must be an option.
        return { ...field, isRequired: false, isHidden: true };
      }

      return field;
    },
  );

  const OUTAGE_TEMPLATE: JSONObject = {
    id: "outage",
    name: "Application Outage",
    answers: {
      title: "The application is down",
      office: "London",
      description: "We are aware of an outage <!channel> and are on it.",
      notes: "Notification type: **Outage**",
      region: "EU",
    },
  };

  const DEFAULT_TEMPLATE: JSONObject = {
    id: "restored",
    name: "Service Restored",
    isDefault: true,
    answers: { description: "Service has been restored." },
  };

  function submitFrom(
    answers: JSONObject,
    templateId?: unknown,
  ): Promise<PublicFormSubmissionResult> {
    const data: JSONObject = { answers };

    if (templateId !== undefined) {
      data["templateId"] = templateId as string;
    }

    return FormService.submitPublicForm({
      shareKey: SHARE_KEY,
      request: { data: data as never },
      clientIp: CLIENT_IP,
      captchaRemoteIp: CLIENT_IP,
    });
  }

  beforeEach(() => {
    storedForm = buildIncidentForm({
      fields: HIDDEN_FIELDS as unknown as JSONArray,
      templates: [OUTAGE_TEMPLATE, DEFAULT_TEMPLATE] as unknown as JSONArray,
    });
  });

  test("the template the submission names answers the hidden questions", async () => {
    await submitFrom({ title: "Checkout is down" }, "outage");

    const incident: Incident = createdIncident();

    expect(incident.description).toBe(
      neutralizeUntrustedMarkdown(
        "We are aware of an outage <!channel> and are on it.",
      ),
    );
    expect(incident.description).not.toContain("<!channel>");
    expect(incident.customFields).toEqual({
      Region: "EU",
      Notes: neutralizeUntrustedMarkdown("Notification type: **Outage**"),
    });
  });

  test("a question the page asks is answered by the submission only: the template only filled the page in", async () => {
    await submitFrom({ title: "Checkout is down", office: "Berlin" }, "outage");

    expect(createdIncident().title).toBe("Checkout is down");

    const answers: Array<FormSubmissionAnswer> = recordedSubmission()
      .answers as unknown as Array<FormSubmissionAnswer>;
    const office: FormSubmissionAnswer | undefined = answers.find(
      (answer: FormSubmissionAnswer): boolean => {
        return answer.fieldId === "office";
      },
    );

    expect(office?.value).toBe("Berlin");
  });

  test("the request is never read for a hidden question", async () => {
    await submitFrom({
      title: "Checkout is down",
      description: "Injected description",
      notes: "Injected notes",
      region: "US",
    });

    const incident: Incident = createdIncident();

    expect(incident.description).toBeUndefined();
    expect(incident.customFields).toEqual({});
  });

  test("nor when it names a template: the template's answer is the one stored", async () => {
    await submitFrom(
      { title: "Checkout is down", description: "Injected description" },
      "outage",
    );

    expect(createdIncident().description).not.toContain("Injected");
  });

  test("a submission that names no template is answered from none - not even the default", async () => {
    await submitFrom({ title: "Checkout is down" });

    expect(createdIncident().description).toBeUndefined();
  });

  test("the default answers a submission that names it, as the page does when it opens on it", async () => {
    await submitFrom({ title: "Checkout is down" }, "restored");

    expect(createdIncident().description).toBe("Service has been restored.");
  });

  test.each([
    ["a template deleted since the page was opened", "deleted"],
    ["something that is not a template's id", "../../outage"],
    ["a template id that is not text", 7],
  ])(
    "a submission that names %s is created all the same, without hidden answers",
    async (_label: string, templateId: unknown) => {
      const result: PublicFormSubmissionResult = await submitFrom(
        { title: "Checkout is down" },
        templateId,
      );

      expect(result.reference).toBe("INC-42");
      expect(createdIncident().description).toBeUndefined();
    },
  );

  test("a hidden answer its question would now refuse is left out, and the rest stands", async () => {
    storedForm = buildIncidentForm({
      fields: HIDDEN_FIELDS as unknown as JSONArray,
      templates: [
        {
          id: "stale",
          name: "Stale",
          answers: { region: "APAC", description: "Still good." },
        },
      ] as unknown as JSONArray,
    });

    await submitFrom({ title: "Checkout is down" }, "stale");

    expect(createdIncident().description).toBe("Still good.");
    expect(createdIncident().customFields).toEqual({});
  });

  test("the hidden answers are kept with the submission, in the form's order", async () => {
    await submitFrom({ title: "Checkout is down" }, "outage");

    const answers: Array<FormSubmissionAnswer> = recordedSubmission()
      .answers as unknown as Array<FormSubmissionAnswer>;

    expect(
      answers.map((answer: FormSubmissionAnswer): string => {
        return answer.fieldId;
      }),
    ).toEqual(["title", "description", "region", "notes"]);
  });

  test("the private note names the template the submission started from", async () => {
    await submitFrom({ title: "Checkout is down", name: "Jane" }, "outage");

    const note: string = (
      incidentNoteCreate.mock.calls[0]![0] as { data: IncidentInternalNote }
    ).data.note!;

    expect(note).toContain("Started from the template **Application Outage**.");
  });

  test("the note names no template when the submission started from none", async () => {
    await submitFrom({ title: "Checkout is down" });

    const note: string = (
      incidentNoteCreate.mock.calls[0]![0] as { data: IncidentInternalNote }
    ).data.note!;

    expect(note).not.toContain("Started from the template");
  });

  test("a hidden title answered by the template becomes the incident's title", async () => {
    storedForm = buildIncidentForm({
      fields: HIDDEN_FIELDS.map((field: FormField): FormField => {
        return field.id === "title"
          ? { ...field, isRequired: false, isHidden: true }
          : field;
      }) as unknown as JSONArray,
      templates: [OUTAGE_TEMPLATE] as unknown as JSONArray,
    });

    await submitFrom({}, "outage");

    expect(createdIncident().title).toBe("The application is down");
  });

  test("a hidden title that would not fit once made safe is refused, as a typed one is", async () => {
    storedForm = buildIncidentForm({
      fields: HIDDEN_FIELDS.map((field: FormField): FormField => {
        return field.id === "title"
          ? { ...field, isRequired: false, isHidden: true }
          : field;
      }) as unknown as JSONArray,
      templates: [
        {
          id: "long",
          name: "Long",
          // Each "<!" grows by an invisible character once made safe.
          answers: { title: "<!".repeat(250) },
        },
      ] as unknown as JSONArray,
    });

    const error: Exception | undefined = await refusal(submitFrom({}, "long"));

    expect(error).toBeInstanceOf(BadDataException);
    nothingCreated();
  });
});
