import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Who hears that an incident reported through a form was created.
 *
 * A form hands its template's owners to IncidentService.create, and the
 * create's own onCreateSuccess chain adds them once the incident's Slack /
 * Microsoft Teams channels exist - seconds after the incident is written,
 * with a workspace connected, and after the submitter has their answer. The
 * owners' "Incident Created" notification is sent by a job
 * (IncidentOwner:SendCreatedResourceEmail) that runs every minute and takes
 * every incident not yet marked as notified. Had it taken the form's
 * incident in between, it would have found no owners, told the project's
 * owners instead and marked the incident done - and the template's owners,
 * the people the report is meant to reach, would have heard nothing ("owner
 * added" is off by default).
 *
 * This drives the real submitPublicForm, the real IncidentService
 * onBeforeCreate and onCreateSuccess chain and the real owner assignment,
 * with the incident table kept in memory and the chain's Slack / Microsoft
 * Teams step held open for as long as a test likes. Where the job would
 * look, it looks with the job's own query.
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
import Form from "../../../Models/DatabaseModels/Form";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import FormRateLimit from "../../../Server/Middleware/FormRateLimit";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import FormService from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UpdateByID from "../../../Server/Types/Database/UpdateByID";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import { FormFieldSource } from "../../../Types/Form/FormField";
import { PublicFormSubmissionResult } from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

type OnBeforeCreate = (
  createBy: CreateBy<Incident>,
) => Promise<OnCreate<Incident>>;

type OnCreateSuccess = (
  onCreate: OnCreate<Incident>,
  createdItem: Incident,
) => Promise<Incident>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const FORM_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_STATE_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const INCIDENT_ID: string = "e0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_OWNER_ID: string = "f0000000-0000-4000-8000-0000000000a1";
const DECLARING_USER_ID: string = "f0000000-0000-4000-8000-0000000000c1";

// The one column of the incident table the job reads, by incident id.
let isOwnerNotified: Map<string, boolean>;
// The incident's owner users, as their rows are written.
let ownerUserIds: Array<string>;
let templateOwners: Array<IncidentTemplateOwnerUser>;
let workspaceStarted: boolean;
let finishWorkspace: () => void;
let ownerRulesApplied: boolean;

// A form that asks for a title only, declaring from a template.
function buildForm(): Form {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Incident;
  form.fields = [
    {
      id: "title",
      source: FormFieldSource.TargetField,
      targetField: "title",
      label: "Title",
      isRequired: true,
    },
  ];
  form.targetSettings = {
    incidentSeverityId: FORM_SEVERITY_ID,
    incidentTemplateId: TEMPLATE_ID,
  };
  form.ipWhitelist = "";
  return form;
}

function templateOwner(userId: string): IncidentTemplateOwnerUser {
  const owner: IncidentTemplateOwnerUser = new IncidentTemplateOwnerUser();
  owner.userId = new ObjectID(userId);
  return owner;
}

/*
 * The incidents the job takes on a run: exactly those whose flag is false -
 * the column's default, for an incident written without it (see the job's
 * query, pinned below).
 */
function incidentsTheJobWouldTake(): Array<string> {
  return Array.from(isOwnerNotified.entries())
    .filter(([, notified]: [string, boolean]): boolean => {
      return !notified;
    })
    .map(([id]: [string, boolean]): string => {
      return id;
    });
}

// The chain runs after the create returns: wait for it to get somewhere.
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("The onCreateSuccess chain did not get there.");
}

function submit(): Promise<PublicFormSubmissionResult> {
  return FormService.submitPublicForm({
    shareKey: SHARE_KEY,
    request: { data: { answers: { title: "Checkout is down" } } },
    clientIp: "203.0.113.7",
  });
}

beforeEach(() => {
  isOwnerNotified = new Map<string, boolean>();
  ownerUserIds = [];
  templateOwners = [templateOwner(TEMPLATE_OWNER_ID)];
  workspaceStarted = false;
  finishWorkspace = (): void => {};
  ownerRulesApplied = false;

  // What submitPublicForm reads and writes.
  jest
    .spyOn(FormService, "findOneBy")
    .mockResolvedValue(buildForm() as never);
  jest
    .spyOn(FormService, "isProjectOnPlan")
    .mockResolvedValue(true as never);
  // The form's severity exists in its project.
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity> => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = FORM_SEVERITY_ID;
      return severity;
    }) as never);
  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
  jest
    .spyOn(FormRateLimit, "reserveFormSubmission")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentTemplateOwnerUserService, "findBy")
    .mockImplementation((async (): Promise<
      Array<IncidentTemplateOwnerUser>
    > => {
      return templateOwners;
    }) as never);
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
  const template: IncidentTemplate = new IncidentTemplate();
  template._id = TEMPLATE_ID;
  template.initialIncidentStateId = new ObjectID(TEMPLATE_STATE_ID);

  jest
    .spyOn(IncidentTemplateService, "findOneBy")
    .mockResolvedValue(template as never);
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
   * The create, as DatabaseService runs it: the real hook, the row written
   * - with the flag as the hook left it, false when it set none - and the
   * real onCreateSuccess, whose chain runs on after the create returns.
   */
  jest.spyOn(IncidentService, "create").mockImplementation((async (
    createBy: CreateBy<Incident>,
  ): Promise<Incident> => {
    const service: {
      onBeforeCreate: OnBeforeCreate;
      onCreateSuccess: OnCreateSuccess;
    } = IncidentService as unknown as {
      onBeforeCreate: OnBeforeCreate;
      onCreateSuccess: OnCreateSuccess;
    };

    const onCreate: OnCreate<Incident> = await service.onBeforeCreate(createBy);

    const incident: Incident = onCreate.createBy.data;
    incident._id = INCIDENT_ID;
    incident.incidentNumber = 7;
    incident.incidentNumberWithPrefix = "INC-7";

    isOwnerNotified.set(
      INCIDENT_ID,
      incident.isOwnerNotifiedOfResourceCreation === true,
    );

    return await service.onCreateSuccess(onCreate, incident);
  }) as never);

  // The job's mark, and the chain's release of it, on the same row.
  jest.spyOn(IncidentService, "updateOneById").mockImplementation((async (
    updateBy: UpdateByID<Incident>,
  ): Promise<void> => {
    const notified: unknown = (updateBy.data as JSONObject)[
      "isOwnerNotifiedOfResourceCreation"
    ];

    if (typeof notified === "boolean") {
      isOwnerNotified.set(updateBy.id.toString(), notified);
    }
  }) as never);

  // The chain, with the incident's Slack / Microsoft Teams step held open.
  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);
  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(new Incident() as never);

  const service: Record<string, unknown> = IncidentService as unknown as Record<
    string,
    unknown
  >;

  jest
    .spyOn(
      service as Record<string, () => Promise<void>>,
      "handleIncidentWorkspaceOperationsAsync",
    )
    .mockImplementation((): Promise<void> => {
      workspaceStarted = true;

      return new Promise<void>((resolve: () => void) => {
        finishWorkspace = resolve;
      });
    });

  for (const method of [
    "createIncidentFeedAsync",
    "handleIncidentStateChangeAsync",
    "handleMonitorStatusChangeAsync",
    "disableActiveMonitoringIfManualIncident",
    "refreshReminderSchedule",
    "executeOnCallDutyPoliciesAsync",
  ]) {
    jest
      .spyOn(service as Record<string, () => Promise<void>>, method)
      .mockResolvedValue(undefined as never);
  }

  jest
    .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(false as never);
  jest
    .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
    .mockImplementation((async (): Promise<void> => {
      ownerRulesApplied = true;
    }) as never);
  jest
    .spyOn(IncidentLabelRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunbookRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentGroupingEngineService, "processIncident")
    .mockResolvedValue({} as never);
  jest
    .spyOn(IncidentSlaService, "createSlaForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
    .mockResolvedValue(false as never);
  jest
    .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);

  // The owner rows: nobody owns the new incident yet.
  jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true as never);
  jest
    .spyOn(IncidentOwnerUserService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentOwnerUser;
    }): Promise<IncidentOwnerUser> => {
      ownerUserIds.push(createBy.data.userId!.toString());
      return createBy.data;
    }) as never);
  jest
    .spyOn(IncidentOwnerTeamService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentOwnerTeam;
    }): Promise<IncidentOwnerTeam> => {
      return createBy.data;
    }) as never);
});

afterEach(() => {
  finishWorkspace();
  jest.restoreAllMocks();
});

describe("the Incident Created notification of an incident reported through a form", () => {
  test("waits for the template's owners: the job cannot take the incident until they are its owners", async () => {
    const result: PublicFormSubmissionResult = await submit();

    // The submitter has their answer; the chain is still creating the channels.
    expect(result.reference).toBe("INC-7");
    await waitUntil((): boolean => {
      return workspaceStarted;
    });

    // A run of the job now finds nothing to notify, rather than no owners.
    expect(ownerUserIds).toEqual([]);
    expect(incidentsTheJobWouldTake()).toEqual([]);

    finishWorkspace();
    await waitUntil((): boolean => {
      return ownerRulesApplied;
    });

    // Its next run takes the incident, whose owners are the template's now.
    expect(ownerUserIds).toEqual([TEMPLATE_OWNER_ID]);
    expect(incidentsTheJobWouldTake()).toEqual([INCIDENT_ID]);
  });

  /*
   * With no owners to wait for, nothing is held: the job takes the incident
   * on its next run and, finding no owners, tells the project's owners - as
   * it does for every incident nobody owns.
   */
  test("holds nothing when the form's template names no owners", async () => {
    templateOwners = [];

    await submit();
    await waitUntil((): boolean => {
      return workspaceStarted;
    });

    expect(incidentsTheJobWouldTake()).toEqual([INCIDENT_ID]);

    finishWorkspace();
    await waitUntil((): boolean => {
      return ownerRulesApplied;
    });

    expect(incidentsTheJobWouldTake()).toEqual([INCIDENT_ID]);
    expect(IncidentService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * Only an internal (root) caller can ask for owners to be notified - misc
   * data is whatever a request body says - so a dashboard declare that asks
   * is written, and notified, as it always was.
   */
  test("holds nothing for a dashboard declare that asks for its template's owners to be notified", async () => {
    // The root cause names the declaring user.
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("Ada" as never);

    const incident: Incident = new Incident();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is down";
    incident.incidentSeverityId = new ObjectID(FORM_SEVERITY_ID);
    incident.createdIncidentTemplateId = TEMPLATE_ID;

    const onCreate: OnCreate<Incident> = await (
      IncidentService as unknown as { onBeforeCreate: OnBeforeCreate }
    ).onBeforeCreate({
      data: incident,
      miscDataProps: {
        ownerUsers: [TEMPLATE_OWNER_ID],
        notifyOwners: true,
      },
      props: {
        tenantId: PROJECT_ID,
        userId: new ObjectID(DECLARING_USER_ID),
      },
    });

    expect(
      onCreate.createBy.data.isOwnerNotifiedOfResourceCreation,
    ).toBeUndefined();
  });

  // What the hold relies on: the job takes exactly the incidents not marked.
  test("the job takes every incident not marked as notified, and nothing else", () => {
    const job: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(job).toContain(
      "IncidentService.findAllBy({ query: { isOwnerNotifiedOfResourceCreation: false, },",
    );
  });
});
