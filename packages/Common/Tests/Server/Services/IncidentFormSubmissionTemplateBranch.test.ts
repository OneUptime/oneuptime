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
 * which is what IncidentFormService.submitPublicForm sends.
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
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFormService from "../../../Server/Services/IncidentFormService";
import IncidentFormSubmissionService from "../../../Server/Services/IncidentFormSubmissionService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  IncidentFormFieldSetting,
  PublicIncidentFormSubmissionResult,
} from "../../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../../Types/JSON";
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

function buildForm(): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.incidentSeverityId = new ObjectID(FORM_SEVERITY_ID);
  form.incidentTemplateId = new ObjectID(TEMPLATE_ID);
  form.allowReporterToChooseSeverity = false;
  form.descriptionSetting = IncidentFormFieldSetting.Optional;
  form.customFieldSettings = { impact: "Required", region: "Optional" };
  form.isReporterDetailsRequired = false;
  form.ipWhitelist = "";
  return form;
}

function customField(
  name: string,
  variableKey: string,
  sortOrder: number,
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.name = name;
  field.variableKey = variableKey;
  field.customFieldType = CustomFieldType.Text;
  field.sortOrder = sortOrder;
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

let storedForm: IncidentForm;
let declared: Incident | null;

beforeEach(() => {
  storedForm = buildForm();
  declared = null;

  // What submitPublicForm reads.
  jest
    .spyOn(IncidentFormService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentForm> => {
      return storedForm;
    }) as never);
  jest
    .spyOn(IncidentFormService, "isProjectOnPlan")
    .mockResolvedValue(true as never);
  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([
      customField("Impact", "impact", 1),
      customField("Region", "region", 2),
      customField("Runbook", "runbook", 3),
    ] as never);
  jest
    .spyOn(IncidentTemplateOwnerUserService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentTemplateOwnerTeamService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentFormSubmissionService, "create")
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

function submit(
  answers: JSONObject,
): Promise<PublicIncidentFormSubmissionResult> {
  return IncidentFormService.submitPublicForm({
    shareKey: SHARE_KEY,
    request: { data: answers } as never,
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
      customFields: { Impact: "High" },
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

  test("keeps the reporter's title, and the form's severity over the template's", async () => {
    await submit({
      title: "Checkout is down",
      customFields: { Impact: "High" },
    });

    expect(declared!.title).toBe("Checkout is down");
    expect(declared!.incidentSeverityId?.toString()).toBe(FORM_SEVERITY_ID);
  });

  test("takes the template's severity when the form's own was deleted", async () => {
    (storedForm as unknown as Record<string, unknown>)["incidentSeverityId"] =
      null;

    await submit({
      title: "Checkout is down",
      customFields: { Impact: "High" },
    });

    expect(declared!.incidentSeverityId?.toString()).toBe(TEMPLATE_SEVERITY_ID);
  });

  test("takes the template's description when the reporter wrote none, and the reporter's when they did", async () => {
    await submit({
      title: "Checkout is down",
      customFields: { Impact: "High" },
    });

    expect(declared!.description).toBe("The template's own description.");

    await submit({
      title: "Checkout is down",
      description: "Orders fail at step 3.",
      customFields: { Impact: "High" },
    });

    expect(declared!.description).toBe("Orders fail at step 3.");
  });

  test("lays the reporter's answers over the template's custom field values", async () => {
    await submit({
      title: "Checkout is down",
      customFields: { Impact: "High", Region: "EU" },
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
      customFields: { Impact: "High" },
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
      customFields: { Impact: "High" },
    });

    expect(declared!.createdByUserId).toBeUndefined();
    expect(declared!.rootCause).toBeUndefined();
  });

  test("tells the reporter the number the project gave the incident", async () => {
    expect(
      await submit({
        title: "Checkout is down",
        customFields: { Impact: "High" },
      }),
    ).toEqual({ incidentNumber: "INC-7" });
    expect(declared!.incidentNumber).toBe(7);
  });
});
