import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import LabelService from "../../../Server/Services/LabelService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../Types/Workflow/CreateFromTemplate";
import { StartingStage } from "../../../Utils/StartingStage";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * A WORKFLOW DECLARES AN INCIDENT FROM ONE OF THE PROJECT'S TEMPLATES.
 *
 * Workflow steps act as a Project Admin of their project (WorkflowPrincipal),
 * and createdIncidentTemplateId is OneUptime's to write, so a Create One
 * Incident step that sent it has been refused since 14.0. The step names its
 * template under its own Incident Template setting instead, and
 * IncidentService.createFromTemplate declares the incident from it with the
 * code that applies a template anywhere on the server.
 *
 * Everything here runs over the real IncidentService.create - the caller,
 * table, column and plan checks, and the incident's own hooks - with the
 * database left out: the template and its owners are read through their
 * services' real permission and plan checks from rows held here, and a
 * create stops just before it would be written, keeping the row it would
 * insert. Billing is on, as on OneUptime Cloud, unless a test says so.
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000002",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000004");

// The project's template, another project's, and one that does not exist.
const TEMPLATE_ID: string = "7c000000-0000-4000-8000-0000000000a1";
const FOREIGN_TEMPLATE_ID: string = "7c000000-0000-4000-8000-0000000000a2";
const MISSING_TEMPLATE_ID: string = "7c000000-0000-4000-8000-0000000000a3";

const TEMPLATE_STATE_ID: string = "7c000000-0000-4000-8000-0000000000b1";
const PICKED_STATE_ID: string = "7c000000-0000-4000-8000-0000000000b2";
const CREATED_STATE_ID: string = "7c000000-0000-4000-8000-0000000000b3";
const TEMPLATE_SEVERITY_ID: string = "7c000000-0000-4000-8000-0000000000c1";
const STEP_SEVERITY_ID: string = "7c000000-0000-4000-8000-0000000000c2";
const TEMPLATE_MONITOR_STATUS_ID: string =
  "7c000000-0000-4000-8000-0000000000c3";
const MONITOR_ID: string = "7c000000-0000-4000-8000-0000000000d1";
const LABEL_ID: string = "7c000000-0000-4000-8000-0000000000d2";
const POLICY_ID: string = "7c000000-0000-4000-8000-0000000000d3";
const STATUS_PAGE_ID: string = "7c000000-0000-4000-8000-0000000000d4";
const OWNER_USER_ID: string = "7c000000-0000-4000-8000-0000000000e1";
const OWNER_TEAM_ID: string = "7c000000-0000-4000-8000-0000000000e2";

const TEMPLATE_CUSTOM_FIELDS: JSONObject = {
  Impact: "Unknown",
  Runbook: "https://runbooks.example/checkout",
};

class PastTheChecks extends Error {
  public constructor() {
    super("Every check passed; the incident would be written now.");
  }
}

// The spy getJestSpyOn hands back.
type SpyInstance = ReturnType<typeof getJestSpyOn>;

type FindOptions = { where?: unknown };

let projectPlan: PlanType = PlanType.Enterprise;
let inserted: Record<string, unknown> | undefined;
let templateOwners: { userIds: Array<string>; teamIds: Array<string> };

let templateFind: SpyInstance;
let ownerUserFind: SpyInstance;
let ownerTeamFind: SpyInstance;
let counter: SpyInstance;
let startingState: SpyInstance;

const savedPlanEnvironment: Record<string, string | undefined> = {};

/*
 * The values a query condition matches: the value itself, an operator's
 * value, or the parameters of a raw condition the permission checks wrote.
 */
function conditionValues(condition: unknown): Array<string> {
  if (condition === null || condition === undefined) {
    return [];
  }

  if (Array.isArray(condition)) {
    return condition.flatMap(conditionValues);
  }

  if (condition instanceof ObjectID) {
    return [condition.toString()];
  }

  if (typeof condition === "object") {
    const parameters: Record<string, unknown> | undefined = (
      condition as { _objectLiteralParameters?: Record<string, unknown> }
    )._objectLiteralParameters;

    if (parameters) {
      return Object.values(parameters).flatMap(conditionValues);
    }

    if ("_value" in (condition as Record<string, unknown>)) {
      return conditionValues((condition as { _value: unknown })._value);
    }
  }

  return [String(condition)];
}

// Whether a row of these column values is one the query names.
function whereMatches(where: unknown, row: Record<string, string>): boolean {
  const clauses: Array<unknown> = Array.isArray(where) ? where : [where];

  return clauses.some((clause: unknown): boolean => {
    return Object.entries(row).every(
      ([column, value]: [string, string]): boolean => {
        const condition: unknown = (
          clause as Record<string, unknown> | undefined
        )?.[column];

        // A column the query leaves open matches every row.
        if (condition === undefined) {
          return true;
        }

        return conditionValues(condition).includes(value);
      },
    );
  });
}

function stub<T extends { _id?: string | undefined }>(
  ctor: new () => T,
  id: string,
): T {
  const record: T = new ctor();
  record._id = id;
  return record;
}

// The template a project holds, as a fresh row each time it is read.
function buildTemplate(id: string): IncidentTemplate {
  const template: IncidentTemplate = new IncidentTemplate();
  template._id = id;
  template.title = "Checkout degraded";
  template.description = "Customers cannot complete checkout.";
  template.incidentSeverityId = new ObjectID(TEMPLATE_SEVERITY_ID);
  template.initialIncidentStateId = new ObjectID(TEMPLATE_STATE_ID);
  template.changeMonitorStatusToId = new ObjectID(TEMPLATE_MONITOR_STATUS_ID);
  template.monitors = [stub(Monitor, MONITOR_ID)];
  template.labels = [stub(Label, LABEL_ID)];
  template.onCallDutyPolicies = [stub(OnCallDutyPolicy, POLICY_ID)];
  template.statusPages = [stub(StatusPage, STATUS_PAGE_ID)];
  template.isScopedToStatusPages = true;
  template.customFields = { ...TEMPLATE_CUSTOM_FIELDS };
  return template;
}

// The templates there are: this project's, and another project's.
const STORED_TEMPLATES: Array<{ _id: string; projectId: string }> = [
  { _id: TEMPLATE_ID, projectId: PROJECT_ID.toString() },
  { _id: FOREIGN_TEMPLATE_ID, projectId: OTHER_PROJECT_ID.toString() },
];

function customField(name: string): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field._id = ObjectID.generate().toString();
  field.name = name;
  field.customFieldType = CustomFieldType.Text;
  return field;
}

// The props a workflow step acts with: a Project Admin, on the plan.
async function stepProps(): Promise<DatabaseCommonInteractionProps> {
  return await WorkflowPrincipal.getProps({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Declare checkout incidents",
  });
}

// A person in the project holding only these permissions.
function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

function newIncident(values: Partial<Record<string, unknown>> = {}): Incident {
  const incident: Incident = new Incident();
  incident.projectId = PROJECT_ID;

  for (const [key, value] of Object.entries(values)) {
    (incident as unknown as Record<string, unknown>)[key] = value;
  }

  return incident;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

// Declares an incident from `templateId` as `props` (a workflow step's).
async function declare(
  data: {
    templateId?: string;
    incident?: Incident;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<unknown> {
  return await rejectionOf(
    IncidentService.createFromTemplate({
      templateId: new ObjectID(data.templateId || TEMPLATE_ID),
      data: data.incident || newIncident(),
      props: data.props || (await stepProps()),
    }),
  );
}

function ids(value: unknown): Array<string> {
  return ((value as Array<{ _id?: string }> | undefined) || []).map(
    (row: { _id?: string }): string => {
      return String(row._id);
    },
  );
}

function text(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  setTestBillingEnabled(true);
  projectPlan = PlanType.Enterprise;
  inserted = undefined;
  templateOwners = { userIds: [OWNER_USER_ID], teamIds: [OWNER_TEAM_ID] };

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    (async () => {
      return { plan: projectPlan, isSubscriptionUnpaid: false };
    }) as never,
  );

  // The templates, read through IncidentTemplateService's own checks.
  templateFind = jest.fn(
    async (options: FindOptions): Promise<Array<IncidentTemplate>> => {
      return STORED_TEMPLATES.filter(
        (stored: { _id: string; projectId: string }): boolean => {
          return whereMatches(options.where, stored);
        },
      ).map((stored: { _id: string }): IncidentTemplate => {
        return buildTemplate(stored._id);
      });
    },
  ) as unknown as SpyInstance;
  getJestSpyOn(IncidentTemplateService, "getRepository").mockReturnValue({
    find: templateFind,
  } as never);

  // The template's owners, read the same way.
  ownerUserFind = jest.fn(
    async (options: FindOptions): Promise<Array<IncidentTemplateOwnerUser>> => {
      return templateOwners.userIds
        .filter((): boolean => {
          return whereMatches(options.where, {
            incidentTemplateId: TEMPLATE_ID,
            projectId: PROJECT_ID.toString(),
          });
        })
        .map((userId: string): IncidentTemplateOwnerUser => {
          const owner: IncidentTemplateOwnerUser =
            new IncidentTemplateOwnerUser();
          owner._id = ObjectID.generate().toString();
          owner.userId = new ObjectID(userId);
          return owner;
        });
    },
  ) as unknown as SpyInstance;
  getJestSpyOn(
    IncidentTemplateOwnerUserService,
    "getRepository",
  ).mockReturnValue({ find: ownerUserFind } as never);

  ownerTeamFind = jest.fn(
    async (options: FindOptions): Promise<Array<IncidentTemplateOwnerTeam>> => {
      return templateOwners.teamIds
        .filter((): boolean => {
          return whereMatches(options.where, {
            incidentTemplateId: TEMPLATE_ID,
            projectId: PROJECT_ID.toString(),
          });
        })
        .map((teamId: string): IncidentTemplateOwnerTeam => {
          const owner: IncidentTemplateOwnerTeam =
            new IncidentTemplateOwnerTeam();
          owner._id = ObjectID.generate().toString();
          owner.teamId = new ObjectID(teamId);
          return owner;
        });
    },
  ) as unknown as SpyInstance;
  getJestSpyOn(
    IncidentTemplateOwnerTeamService,
    "getRepository",
  ).mockReturnValue({ find: ownerTeamFind } as never);

  // Every state named is one of the project's open states.
  startingState = getJestSpyOn(
    IncidentStateService,
    "getStartingState",
  ).mockResolvedValue({
    stage: StartingStage.Open,
    flaggedResolved: false,
  } as never);
  getJestSpyOn(
    IncidentStateService,
    "getCreatedIncidentStateId",
  ).mockResolvedValue(new ObjectID(CREATED_STATE_ID) as never);

  // Every other record named is the project's (that check has its own suites).
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined as never);

  counter = getJestSpyOn(
    ProjectService,
    "incrementAndGetIncidentCounter",
  ).mockResolvedValue({ counter: 7, prefix: "INC-" } as never);
  getJestSpyOn(
    CustomFieldMappingService,
    "applyMappingsToCreate",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([
    customField("Impact"),
    customField("Runbook"),
  ] as never);

  // The incident is written by no one: the create stops just before.
  getJestSpyOn(IncidentService, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(IncidentService, "assertCreateWillInsert").mockImplementation(((
    data: unknown,
  ): never => {
    inserted = { ...(data as Record<string, unknown>) };
    throw new PastTheChecks();
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("an incident declared from a template, as a workflow step", () => {
  test("the template fills in everything the step leaves out, and the incident records the template", async () => {
    expect(await declare()).toBeInstanceOf(PastTheChecks);

    expect(inserted?.["title"]).toBe("Checkout degraded");
    expect(inserted?.["description"]).toBe(
      "Customers cannot complete checkout.",
    );
    expect(text(inserted?.["incidentSeverityId"])).toBe(TEMPLATE_SEVERITY_ID);
    expect(text(inserted?.["currentIncidentStateId"])).toBe(TEMPLATE_STATE_ID);
    expect(text(inserted?.["changeMonitorStatusToId"])).toBe(
      TEMPLATE_MONITOR_STATUS_ID,
    );
    expect(ids(inserted?.["monitors"])).toEqual([MONITOR_ID]);
    expect(ids(inserted?.["labels"])).toEqual([LABEL_ID]);
    expect(ids(inserted?.["onCallDutyPolicies"])).toEqual([POLICY_ID]);
    expect(ids(inserted?.["statusPages"])).toEqual([STATUS_PAGE_ID]);
    expect(inserted?.["customFields"]).toEqual(TEMPLATE_CUSTOM_FIELDS);

    // The template it was declared from, in the workflow's project, by no one.
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
    expect(text(inserted?.["projectId"])).toBe(PROJECT_ID.toString());
    expect(inserted?.["createdByUserId"]).toBeUndefined();
    expect(inserted?.["incidentNumber"]).toBe(7);
  });

  test("whatever the step sets wins over the template's, and a list it empties stays empty", async () => {
    expect(
      await declare({
        incident: newIncident({
          title: "Checkout is down",
          description: "Card payments fail at the last step.",
          incidentSeverityId: new ObjectID(STEP_SEVERITY_ID),
          labels: [],
          customFields: { Impact: "High" },
        }),
      }),
    ).toBeInstanceOf(PastTheChecks);

    expect(inserted?.["title"]).toBe("Checkout is down");
    expect(inserted?.["description"]).toBe(
      "Card payments fail at the last step.",
    );
    expect(text(inserted?.["incidentSeverityId"])).toBe(STEP_SEVERITY_ID);
    expect(ids(inserted?.["labels"])).toEqual([]);
    // The step's custom field value over the template's, the template's beside it.
    expect(inserted?.["customFields"]).toEqual({
      Impact: "High",
      Runbook: "https://runbooks.example/checkout",
    });

    // What the step left out still comes from the template.
    expect(ids(inserted?.["monitors"])).toEqual([MONITOR_ID]);
    expect(text(inserted?.["currentIncidentStateId"])).toBe(TEMPLATE_STATE_ID);
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
  });

  test("a state the step picks is where the incident starts, and the rest of the template still applies", async () => {
    expect(
      await declare({
        incident: newIncident({
          currentIncidentStateId: new ObjectID(PICKED_STATE_ID),
        }),
      }),
    ).toBeInstanceOf(PastTheChecks);

    expect(text(inserted?.["currentIncidentStateId"])).toBe(PICKED_STATE_ID);
    expect(
      startingState.mock.calls.map((call: Array<unknown>): string => {
        return String(
          (call[0] as { incidentStateId: ObjectID }).incidentStateId,
        );
      }),
    ).toEqual([PICKED_STATE_ID]);

    expect(inserted?.["title"]).toBe("Checkout degraded");
    expect(ids(inserted?.["monitors"])).toEqual([MONITOR_ID]);
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
  });

  test("the template's owners are handed to the incident, read as the step and added quietly", async () => {
    const create: SpyInstance = getJestSpyOn(IncidentService, "create");
    const ownerRead: SpyInstance = getJestSpyOn(
      IncidentTemplateOwnerUserService,
      "findBy",
    );

    expect(await declare()).toBeInstanceOf(PastTheChecks);

    const createBy: CreateBy<Incident> = create.mock
      .calls[0]![0] as CreateBy<Incident>;

    expect(ids(asRows(createBy.miscDataProps?.["ownerUsers"]))).toEqual([
      OWNER_USER_ID,
    ]);
    expect(ids(asRows(createBy.miscDataProps?.["ownerTeams"]))).toEqual([
      OWNER_TEAM_ID,
    ]);

    // Added as the dashboard adds a template's owners: nobody is told.
    expect(createBy.miscDataProps?.["notifyOwners"]).toBeUndefined();
    expect(inserted?.["isOwnerNotifiedOfResourceCreation"]).not.toBe(true);

    // Read as the step - a Project Admin of the project - not as OneUptime.
    const readProps: DatabaseCommonInteractionProps = (
      ownerRead.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(readProps.isRoot).toBeFalsy();
    expect(readProps.userType).toBe(UserType.Workflow);
    expect(ownerUserFind).toHaveBeenCalledTimes(1);
    expect(ownerTeamFind).toHaveBeenCalledTimes(1);
  });

  test("a template with no owners hands none over", async () => {
    templateOwners = { userIds: [], teamIds: [] };
    const create: SpyInstance = getJestSpyOn(IncidentService, "create");

    expect(await declare()).toBeInstanceOf(PastTheChecks);

    const createBy: CreateBy<Incident> = create.mock
      .calls[0]![0] as CreateBy<Incident>;

    expect(createBy.miscDataProps?.["ownerUsers"]).toBeUndefined();
    expect(createBy.miscDataProps?.["ownerTeams"]).toBeUndefined();
  });

  test("the template is read as the step, in the workflow's project only", async () => {
    const templateRead: SpyInstance = getJestSpyOn(
      IncidentTemplateService,
      "findOneBy",
    );

    expect(await declare()).toBeInstanceOf(PastTheChecks);

    const readProps: DatabaseCommonInteractionProps = (
      templateRead.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }
    ).props;

    expect(readProps.isRoot).toBeFalsy();
    expect(readProps.userType).toBe(UserType.Workflow);

    const where: Record<string, unknown> = (
      templateFind.mock.calls[0]![0] as { where: Record<string, unknown> }
    ).where;

    expect(conditionValues(where["projectId"])).toEqual([
      PROJECT_ID.toString(),
    ]);
  });
});

describe("a template that is not the project's is refused like any reference that is not", () => {
  function refusalFor(templateId: string): string {
    return ProjectScopedReferenceValidator.getRefusalMessage({
      subject: "incident",
      described: [`Incident Template "${templateId}"`],
    });
  }

  test.each([
    ["another project's template", FOREIGN_TEMPLATE_ID],
    ["a template that does not exist", MISSING_TEMPLATE_ID],
  ])(
    "%s: refused before a number is taken, its owners read or anything written",
    async (_case: string, templateId: string) => {
      const error: unknown = await declare({ templateId });

      expect(error).toBeInstanceOf(ProjectScopedReferenceException);
      expect((error as Error).message).toBe(refusalFor(templateId));
      expect(templateFind).toHaveBeenCalledTimes(1);
      expect(ownerUserFind).not.toHaveBeenCalled();
      expect(ownerTeamFind).not.toHaveBeenCalled();
      expect(counter).not.toHaveBeenCalled();
      expect(inserted).toBeUndefined();
    },
  );

  test("the two are told apart by nothing but the id they name", async () => {
    const foreign: string = (
      (await declare({
        templateId: FOREIGN_TEMPLATE_ID,
      })) as Error
    ).message;
    const missing: string = (
      (await declare({
        templateId: MISSING_TEMPLATE_ID,
      })) as Error
    ).message;

    expect(foreign.replace(FOREIGN_TEMPLATE_ID, "<id>")).toBe(
      missing.replace(MISSING_TEMPLATE_ID, "<id>"),
    );
  });

  test("an id that is not an id is refused alike, without a read", async () => {
    const error: unknown = await rejectionOf(
      IncidentService.createFromTemplate({
        templateId: new ObjectID("checkout-template"),
        data: newIncident(),
        props: await stepProps(),
      }),
    );

    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
    expect((error as Error).message).toBe(refusalFor("checkout-template"));
    expect(templateFind).not.toHaveBeenCalled();
    expect(inserted).toBeUndefined();
  });
});

describe("the step's plan and permissions still decide", () => {
  test("a plan without incident templates refuses the step as it refuses the dashboard, before anything is read or written", async () => {
    projectPlan = PlanType.Free;

    const error: unknown = await declare();

    expect(error).toBeInstanceOf(PaymentRequiredException);
    expect((error as Error).message).toContain(
      "Please upgrade your plan to Growth",
    );
    expect(templateFind).not.toHaveBeenCalled();
    expect(counter).not.toHaveBeenCalled();
    expect(inserted).toBeUndefined();
  });

  test("on a plan that includes templates the step declares from one", async () => {
    projectPlan = PlanType.Growth;

    expect(await declare()).toBeInstanceOf(PastTheChecks);
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
  });

  test("with billing off, as on a self-hosted server, every project declares from its templates", async () => {
    setTestBillingEnabled(false);
    projectPlan = PlanType.Free;

    expect(await declare()).toBeInstanceOf(PastTheChecks);
    expect(inserted?.["title"]).toBe("Checkout degraded");
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
  });

  test("a caller who may not create incidents is refused before the template is read", async () => {
    const error: unknown = await declare({
      props: memberProps([
        Permission.ReadProjectIncident,
        Permission.ReadIncidentTemplate,
      ]),
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(templateFind).not.toHaveBeenCalled();
    expect(ownerUserFind).not.toHaveBeenCalled();
    expect(inserted).toBeUndefined();
  });

  test("a caller who may create incidents but not read templates is told so, and nothing is written", async () => {
    const error: unknown = await declare({
      props: memberProps([
        Permission.CreateProjectIncident,
        Permission.ReadProjectIncident,
      ]),
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(templateFind).not.toHaveBeenCalled();
    expect(counter).not.toHaveBeenCalled();
    expect(inserted).toBeUndefined();
  });

  test("every value the template adds meets the caller's column checks, and the template's id is written only after them", async () => {
    // The record each column check read, as it read it.
    const checked: Array<Record<string, unknown>> = [];
    const checkCreatePermissions: typeof ModelPermission.checkCreatePermissions =
      ModelPermission.checkCreatePermissions.bind(ModelPermission);
    const columnCheck: SpyInstance = getJestSpyOn(
      ModelPermission,
      "checkCreatePermissions",
    ).mockImplementation(((
      modelType: Parameters<typeof checkCreatePermissions>[0],
      data: Parameters<typeof checkCreatePermissions>[1],
      props: Parameters<typeof checkCreatePermissions>[2],
    ): ReturnType<typeof checkCreatePermissions> => {
      checked.push({ ...(data as unknown as Record<string, unknown>) });
      return checkCreatePermissions(modelType, data, props);
    }) as never);
    const permitted: SpyInstance = getJestSpyOn(
      IncidentService,
      "onCreatePermitted",
    );

    expect(await declare()).toBeInstanceOf(PastTheChecks);

    const lastCheck: Record<string, unknown> = checked[checked.length - 1]!;

    // The template's values were in the record the last check read...
    expect(ids(lastCheck["monitors"])).toEqual([MONITOR_ID]);
    // ...and its id was not: that is written once the checks have passed.
    expect(lastCheck["createdIncidentTemplateId"]).toBeUndefined();
    expect(Math.max(...columnCheck.mock.invocationCallOrder)).toBeLessThan(
      permitted.mock.invocationCallOrder[0]!,
    );
  });

  test("a create the column check refuses never records the template", async () => {
    getJestSpyOn(ModelPermission, "checkCreatePermissions").mockImplementation(
      (() => {
        throw new NotAuthorizedException("Refused by the column check.");
      }) as never,
    );
    const permitted: SpyInstance = getJestSpyOn(
      IncidentService,
      "onCreatePermitted",
    );

    const error: unknown = await declare();

    expect((error as Error).message).toBe("Refused by the column check.");
    expect(permitted).not.toHaveBeenCalled();
    expect(inserted).toBeUndefined();
  });
});

describe("the template's id stays OneUptime's to write", () => {
  test("a step that sends it in its record is refused, naming the column", async () => {
    const error: unknown = await rejectionOf(
      IncidentService.create({
        data: newIncident({
          title: "Checkout is down",
          incidentSeverityId: new ObjectID(STEP_SEVERITY_ID),
          createdIncidentTemplateId: new ObjectID(TEMPLATE_ID),
        }),
        props: await stepProps(),
      }),
    );

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "createdIncidentTemplateId",
    );
    expect(inserted).toBeUndefined();
  });

  test("so is one that sends it beside the setting: there would be two templates", async () => {
    const error: unknown = await declare({
      incident: newIncident({
        createdIncidentTemplateId: new ObjectID(FOREIGN_TEMPLATE_ID),
      }),
    });

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect((error as ColumnWriteRefusedException).columnName).toBe(
      "createdIncidentTemplateId",
    );
    expect(templateFind).not.toHaveBeenCalled();
    expect(inserted).toBeUndefined();
  });

  test("a declaration is its own create's: the next incident records no template", async () => {
    expect(await declare()).toBeInstanceOf(PastTheChecks);
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);

    inserted = undefined;

    expect(
      await rejectionOf(
        IncidentService.create({
          data: newIncident({
            title: "Search is slow",
            incidentSeverityId: new ObjectID(STEP_SEVERITY_ID),
          }),
          props: await stepProps(),
        }),
      ),
    ).toBeInstanceOf(PastTheChecks);
    expect(inserted?.["createdIncidentTemplateId"]).toBeUndefined();
    expect(ids(inserted?.["monitors"])).toEqual([]);
  });

  test("a create without its hooks cannot declare from a template", async () => {
    const error: unknown = await declare({
      props: { ...(await stepProps()), ignoreHooks: true },
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "An incident cannot be declared from a template without its hooks.",
    );
    expect(inserted).toBeUndefined();
  });

  test("OneUptime still names the template in the record itself (an incident form), and reads it as itself", async () => {
    const templateRead: SpyInstance = getJestSpyOn(
      IncidentTemplateService,
      "findOneBy",
    );

    expect(
      await rejectionOf(
        IncidentService.create({
          data: newIncident({
            title: "Reported through the status page",
            createdIncidentTemplateId: new ObjectID(TEMPLATE_ID),
          }),
          props: { isRoot: true, tenantId: PROJECT_ID },
        }),
      ),
    ).toBeInstanceOf(PastTheChecks);

    expect(inserted?.["title"]).toBe("Reported through the status page");
    expect(ids(inserted?.["monitors"])).toEqual([MONITOR_ID]);
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
    expect(
      (
        templateRead.mock.calls[0]![0] as {
          props: DatabaseCommonInteractionProps;
        }
      ).props.isRoot,
    ).toBe(true);
    // A form hands its template's owners over itself.
    expect(ownerUserFind).not.toHaveBeenCalled();
  });

  test("a record with no templates cannot be created from one", async () => {
    const error: unknown = await rejectionOf(
      LabelService.createFromTemplate({
        templateId: new ObjectID(TEMPLATE_ID),
        data: new Label(),
        props: await stepProps(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Label cannot be created from a template.",
    );
  });
});

/*
 * The Create One Incident step, end to end: its Incident Template setting
 * goes to createFromTemplate as the step, and what is refused is said in
 * the run log in plain words.
 */
describe("the Create One Incident step's Incident Template setting", () => {
  interface StepRun {
    result: RunReturnType;
    lines: Array<string>;
  }

  async function runStep(args: JSONObject): Promise<StepRun> {
    const lines: Array<string> = [];
    const component: ComponentCode = new CreateOneBaseModel<Incident>(
      IncidentService,
    );
    const options: RunOptions = {
      log: ((line: unknown): void => {
        lines.push(typeof line === "string" ? line : JSON.stringify(line));
      }) as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: WORKFLOW_ID,
      workflowName: "Declare checkout incidents",
      projectId: PROJECT_ID,
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    };

    const result: RunReturnType = await component.run(args, options);

    return { result, lines };
  }

  function refusals(lines: Array<string>): Array<string> {
    return lines.filter((line: string): boolean => {
      return line.includes("was refused");
    });
  }

  test("with only a template picked, the step declares the incident from it", async () => {
    const step: StepRun = await runStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
    });

    expect(refusals(step.lines)).toEqual([]);
    expect(inserted?.["title"]).toBe("Checkout degraded");
    expect(text(inserted?.["createdIncidentTemplateId"])).toBe(TEMPLATE_ID);
    expect(text(inserted?.["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("its JSON Object sets what should differ from the template", async () => {
    const step: StepRun = await runStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      json: { title: "Checkout is down in eu-west-1" },
    });

    expect(refusals(step.lines)).toEqual([]);
    expect(inserted?.["title"]).toBe("Checkout is down in eu-west-1");
    expect(inserted?.["description"]).toBe(
      "Customers cannot complete checkout.",
    );
  });

  test("on a plan without templates, the run log names the plan", async () => {
    projectPlan = PlanType.Free;

    const step: StepRun = await runStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(refusals(step.lines)).toEqual([
      expect.stringContaining(
        "because of this project's plan: Please upgrade your plan to Growth",
      ),
    ]);
    expect(inserted).toBeUndefined();
  });

  test("another project's template takes the error port with the project's words", async () => {
    const step: StepRun = await runStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: FOREIGN_TEMPLATE_ID,
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(step.lines).toContain(
      ProjectScopedReferenceValidator.getRefusalMessage({
        subject: "incident",
        described: [`Incident Template "${FOREIGN_TEMPLATE_ID}"`],
      }),
    );
    expect(inserted).toBeUndefined();
  });

  test("a step still sending createdIncidentTemplateId is pointed at the setting", async () => {
    const step: StepRun = await runStep({
      json: {
        title: "Checkout is down",
        incidentSeverityId: STEP_SEVERITY_ID,
        createdIncidentTemplateId: TEMPLATE_ID,
      },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(step.lines).toContain(
      'Tip: to declare the Incident from a template, pick the template under Incident Template on this step, and take "createdIncidentTemplateId" out of JSON Object.',
    );
    expect(inserted).toBeUndefined();
  });
});

function asRows(value: unknown): Array<{ _id: string }> {
  return ((value as Array<ObjectID> | undefined) || []).map(
    (id: ObjectID): { _id: string } => {
      return { _id: id.toString() };
    },
  );
}
