import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A form tied to an incident template relies on IncidentService's template
 * branch to apply the template: the initial state, the severity when none is
 * set, the description when the reporter wrote none, the monitors, labels
 * and status pages, a monitor status change, and the template's custom field
 * values under the reporter's answers. That branch only runs for a create
 * that sets no state and names the template by createdIncidentTemplateId -
 * which is what FormService.submitPublicForm sends for an incident form.
 *
 * The submission suite pins what submitPublicForm hands to
 * IncidentService.create. This one closes the loop: it feeds exactly that
 * incident to the REAL IncidentService.onBeforeCreate (the reads it makes
 * are stubbed) and checks the incident that comes out - so a change on
 * either side that stopped the template applying, or let it switch status
 * page visibility back on, fails here.
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

import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import Form from "../../../Models/DatabaseModels/Form";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import FormRateLimit from "../../../Server/Middleware/FormRateLimit";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import FormService from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { FormField, FormFieldSource } from "../../../Types/Form/FormField";
import { PublicFormSubmissionResult } from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

type OnBeforeCreate = (
  createBy: CreateBy<Incident>,
) => Promise<OnCreate<Incident>>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const FORM_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f2";
const TEMPLATE_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_STATE_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_MONITOR_STATUS_ID: string =
  "d0000000-0000-4000-8000-0000000000f2";
const MONITOR_ID: string = "e1000000-0000-4000-8000-0000000000f1";
const LABEL_ID: string = "e2000000-0000-4000-8000-0000000000f1";
const STATUS_PAGE_ID: string = "e3000000-0000-4000-8000-0000000000f1";
const IMPACT_FIELD_ID: string = "e4000000-0000-4000-8000-0000000000f1";
const REGION_FIELD_ID: string = "e4000000-0000-4000-8000-0000000000f2";
const RUNBOOK_FIELD_ID: string = "e4000000-0000-4000-8000-0000000000f3";

// A title, a description, a required Impact and an optional Region.
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
  },
  {
    id: "impact",
    source: FormFieldSource.TargetCustomField,
    customFieldId: IMPACT_FIELD_ID,
    label: "Impact",
    isRequired: true,
  },
  {
    id: "region",
    source: FormFieldSource.TargetCustomField,
    customFieldId: REGION_FIELD_ID,
    label: "Region",
    isRequired: false,
  },
];

// Whether the form's own severity still exists in its project.
let formSeverityExists: boolean = true;

function buildForm(): Form {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Incident;
  form.fields = FIELDS as unknown as JSONArray;
  form.targetSettings = {
    incidentSeverityId: FORM_SEVERITY_ID,
    incidentTemplateId: TEMPLATE_ID,
  };
  form.ipWhitelist = "";
  return form;
}

function customField(id: string, name: string): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field._id = id;
  field.name = name;
  field.customFieldType = CustomFieldType.Text;
  return field;
}

function buildTemplate(): IncidentTemplate {
  const template: IncidentTemplate = new IncidentTemplate();
  template._id = TEMPLATE_ID;
  template.initialIncidentStateId = new ObjectID(TEMPLATE_STATE_ID);
  template.incidentSeverityId = new ObjectID(TEMPLATE_SEVERITY_ID);
  template.changeMonitorStatusToId = new ObjectID(TEMPLATE_MONITOR_STATUS_ID);
  template.title = "Template title the reporter's replaces";
  template.description = "The template's own description.";

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  template.monitors = [monitor];

  const label: Label = new Label();
  label._id = LABEL_ID;
  template.labels = [label];

  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  template.statusPages = [statusPage];

  template.customFields = {
    Impact: "Unknown",
    Runbook: "https://runbooks.example/checkout",
  };

  return template;
}

let storedForm: Form;
let declared: Incident | null;

beforeEach(() => {
  storedForm = buildForm();
  declared = null;
  formSeverityExists = true;

  // What submitPublicForm reads.
  jest
    .spyOn(FormService, "findOneBy")
    .mockImplementation((async (): Promise<Form> => {
      return storedForm;
    }) as never);
  jest
    .spyOn(FormService, "isProjectOnPlan")
    .mockResolvedValue(true as never);
  // The form's own severity, when it still exists in its project.
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity | null> => {
      if (!formSeverityExists) {
        return null;
      }

      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = FORM_SEVERITY_ID;
      return severity;
    }) as never);
  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
  // The form's hourly ceiling lives in Redis, which this suite has none of.
  jest
    .spyOn(FormRateLimit, "reserveFormSubmission")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([
      customField(IMPACT_FIELD_ID, "Impact"),
      customField(REGION_FIELD_ID, "Region"),
      customField(RUNBOOK_FIELD_ID, "Runbook"),
    ] as never);
  jest
    .spyOn(IncidentTemplateOwnerUserService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentTemplateOwnerTeamService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(FormSubmissionService, "create")
    .mockImplementation((async (createBy: { data: unknown }) => {
      return createBy.data;
    }) as never);
  jest
    .spyOn(IncidentInternalNoteService, "create")
    .mockImplementation((async (createBy: { data: unknown }) => {
      return createBy.data;
    }) as never);

  // What the real IncidentService.onBeforeCreate reads.
  jest
    .spyOn(IncidentTemplateService, "findOneBy")
    .mockResolvedValue(buildTemplate() as never);
  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<IncidentState> => {
      const state: IncidentState = new IncidentState();
      state._id =
        findBy.query["isCreatedState"] === true
          ? "d0000000-0000-4000-8000-0000000000aa"
          : String(findBy.query["_id"]);
      return state;
    }) as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentCounter")
    .mockResolvedValue({ counter: 7, prefix: "INC-" } as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);

  /*
   * The create itself runs the real hook on what submitPublicForm sends,
   * and hands back what the hook made of it, as the database would.
   */
  jest.spyOn(IncidentService, "create").mockImplementation((async (
    createBy: CreateBy<Incident>,
  ): Promise<Incident> => {
    const onCreate: OnCreate<Incident> = await (
      IncidentService as unknown as { onBeforeCreate: OnBeforeCreate }
    ).onBeforeCreate(createBy);

    declared = onCreate.createBy.data;
    declared._id = "f0000000-0000-4000-8000-0000000000f1";

    return declared;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function submit(answers: JSONObject): Promise<PublicFormSubmissionResult> {
  return FormService.submitPublicForm({
    shareKey: SHARE_KEY,
    request: { data: { answers } },
    clientIp: "203.0.113.7",
  });
}

function ids(
  rows: Array<{ _id?: string | undefined }> | undefined,
): Array<string> {
  return (rows || []).map((row: { _id?: string | undefined }) => {
    return String(row._id);
  });
}

describe("a submission through a form with a template, through the real IncidentService hook", () => {
  test("starts in the template's state and carries its monitors, labels, status pages and monitor status change", async () => {
    await submit({
      title: "Checkout is down",
      impact: "High",
    });

    expect(declared).not.toBeNull();
    expect(declared!.currentIncidentStateId?.toString()).toBe(
      TEMPLATE_STATE_ID,
    );
    expect(ids(declared!.monitors)).toEqual([MONITOR_ID]);
    expect(ids(declared!.labels)).toEqual([LABEL_ID]);
    expect(ids(declared!.statusPages)).toEqual([STATUS_PAGE_ID]);
    expect(declared!.changeMonitorStatusToId?.toString()).toBe(
      TEMPLATE_MONITOR_STATUS_ID,
    );
  });

  test("keeps the submitter's title, and the form's severity over the template's", async () => {
    await submit({
      title: "Checkout is down",
      impact: "High",
    });

    expect(declared!.title).toBe("Checkout is down");
    expect(declared!.incidentSeverityId?.toString()).toBe(FORM_SEVERITY_ID);
  });

  test("takes the template's severity when the form's own was deleted", async () => {
    formSeverityExists = false;

    await submit({
      title: "Checkout is down",
      impact: "High",
    });

    expect(declared!.incidentSeverityId?.toString()).toBe(TEMPLATE_SEVERITY_ID);
  });

  test("takes the template's description when the submitter wrote none, and the submitter's when they did", async () => {
    await submit({
      title: "Checkout is down",
      impact: "High",
    });

    expect(declared!.description).toBe("The template's own description.");

    await submit({
      title: "Checkout is down",
      description: "Orders fail at step 3.",
      impact: "High",
    });

    expect(declared!.description).toBe("Orders fail at step 3.");
  });

  test("lays the submitter's answers over the template's custom field values", async () => {
    await submit({
      title: "Checkout is down",
      impact: "High",
      region: "EU",
    });

    expect(declared!.customFields).toEqual({
      Impact: "High",
      Region: "EU",
      Runbook: "https://runbooks.example/checkout",
    });
  });

  /*
   * The template names status pages, which scopes the incident to them -
   * and it still starts off every page and without notifying anybody,
   * until a responder publishes it.
   */
  test("stays off the template's status pages, and notifies none of their subscribers", async () => {
    await submit({
      title: "Checkout is down",
      impact: "High",
    });

    expect(declared!.isScopedToStatusPages).toBe(true);
    expect(declared!.isVisibleOnStatusPage).toBe(false);
    expect(
      declared!.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(false);
    expect(declared!.subscriberNotificationStatusOnIncidentCreated).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("names no creating user and writes no root cause", async () => {
    await submit({
      title: "Checkout is down",
      impact: "High",
    });

    expect(declared!.createdByUserId).toBeUndefined();
    expect(declared!.rootCause).toBeUndefined();
  });

  test("tells the submitter the number the project gave the incident", async () => {
    expect(
      await submit({
        title: "Checkout is down",
        impact: "High",
      }),
    ).toEqual({ reference: "INC-7" });
    expect(declared!.incidentNumber).toBe(7);
  });
});
