import Alert from "../../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Models from "../../../../../Models/DatabaseModels/Index";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TeamService from "../../../../../Server/Services/TeamService";
import UserService from "../../../../../Server/Services/UserService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import ProjectMembership from "../../../../../Server/Utils/TeamMember/ProjectMembership";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Email from "../../../../../Types/Email";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../../../Types/Workflow/CreateFromTemplate";
import { getComponentDocumentation } from "../../../../../Types/Workflow/Documentation/Index";
import ComponentDocumentation, {
  ComponentDocumentationTopic,
} from "../../../../../Types/Workflow/Documentation/ComponentDocumentation";
import {
  MAX_OWNERS_ON_CREATE,
  OWNER_TEAMS_ARGUMENT_ID,
  OWNER_USERS_ARGUMENT_ID,
} from "../../../../../Types/Workflow/OwnersOnCreateSetting";
import {
  OWNER_TEAMS_ON_CREATE_KEY,
  OWNER_USERS_ON_CREATE_KEY,
  TABLES_TAKING_OWNERS_ON_CREATE,
} from "../../../../../Types/Database/OwnersOnCreate";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

// Billing on, as on OneUptime Cloud: a step's props carry the project's plan.
jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * CREATE ONE INCIDENT'S AND CREATE ONE ALERT'S OWNERS (#8198).
 *
 * A workflow could only add an incident's owners in a step after its
 * create, and the owners' Created email - sent about a minute after the
 * create, to the owners it has by then - missed them whenever that step
 * came later: a delay, a long step in between. Now the step takes them with
 * the create, Owner Users and Owner Teams, and hands them to the record's
 * service as the REST create does (miscDataProps' ownerUsers and
 * ownerTeams), as itself: a Project Admin of the workflow's project, never
 * root, whom the service asks about them before anything is saved. People
 * are found by ID or email address among the project's members, teams
 * among its teams; what names nobody is said in the run log and never fails
 * the step. CreatedNotificationWaitsForOwners runs the real step through
 * the real create and job, to the email.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8d000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "8d000000-0000-4000-8000-000000000002",
);
const TEMPLATE_ID: string = "8d000000-0000-4000-8000-0000000000a1";

const ANA: string = "8d000000-0000-4000-8000-0000000000b1";
const BEN: string = "8d000000-0000-4000-8000-0000000000b2";
// Somebody with an account, who is no member of this project.
const STRANGER: string = "8d000000-0000-4000-8000-0000000000b9";
const BEN_EMAIL: string = "ben@acme.test";
const STRANGER_EMAIL: string = "stranger@elsewhere.test";

const PLATFORM_TEAM: string = "8d000000-0000-4000-8000-0000000000c1";
// Another project's team.
const OTHER_PROJECTS_TEAM: string = "8d000000-0000-4000-8000-0000000000c9";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

let createIncident: SpyInstance;
let createAlert: SpyInstance;
let fromTemplate: SpyInstance;
let createMaintenance: SpyInstance;
let findUsers: SpyInstance;
let findTeams: SpyInstance;
let findMembers: SpyInstance;

// The project's members, by id; and everybody's email addresses.
let members: Array<string>;
const EMAILS: Record<string, string> = {
  [BEN_EMAIL]: BEN,
  [STRANGER_EMAIL]: STRANGER,
};

function valuesOf(query: unknown, column: string): Array<string> {
  const value: unknown = (query as Record<string, unknown>)[column];
  const parameters: Record<string, unknown> =
    ((value as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((item: unknown): string => {
    return String(item).toLowerCase();
  });
}

async function run(
  component: ComponentCode,
  args: JSONObject,
): Promise<StepRun> {
  const lines: Array<string> = [];
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

function runIncidentStep(args: JSONObject): Promise<StepRun> {
  return run(new CreateOneBaseModel<Incident>(IncidentService), args);
}

function runAlertStep(args: JSONObject): Promise<StepRun> {
  return run(new CreateOneBaseModel<Alert>(AlertService), args);
}

interface Handed {
  data: BaseModel;
  miscDataProps?: JSONObject | undefined;
  props: DatabaseCommonInteractionProps;
}

function handed(spy: SpyInstance): Handed {
  return spy.mock.calls[0]![0] as Handed;
}

function idsIn(value: unknown): Array<string> {
  return ((value as Array<ObjectID>) || []).map((id: ObjectID): string => {
    return id.toString().toLowerCase();
  });
}

function createOneOf(model: BaseModel): ComponentMetadata | undefined {
  return BaseModelComponents.getComponents(model).find(
    (component: ComponentMetadata): boolean => {
      return component.id.endsWith("-create-one");
    },
  );
}

beforeEach(() => {
  setTestBillingEnabled(true);
  members = [ANA, BEN];

  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

  createIncident = getJestSpyOn(IncidentService, "create").mockImplementation(
    (async (createBy: { data: Incident }) => {
      return createBy.data;
    }) as never,
  );
  fromTemplate = getJestSpyOn(
    IncidentService,
    "createFromTemplate",
  ).mockImplementation((async (data: { data: Incident }) => {
    return data.data;
  }) as never);
  createAlert = getJestSpyOn(AlertService, "create").mockImplementation(
    (async (createBy: { data: Alert }) => {
      return createBy.data;
    }) as never,
  );
  createMaintenance = getJestSpyOn(
    ScheduledMaintenanceService,
    "create",
  ).mockImplementation((async (createBy: { data: ScheduledMaintenance }) => {
    return createBy.data;
  }) as never);

  // Everybody with an account, by id or by email address.
  findUsers = getJestSpyOn(UserService, "findBy").mockImplementation(
    (async (data: { query: Record<string, unknown> }): Promise<Array<User>> => {
      if (data.query["email"]) {
        return valuesOf(data.query, "email")
          .filter((email: string): boolean => {
            return Boolean(EMAILS[email]);
          })
          .map((email: string): User => {
            const user: User = new User(new ObjectID(EMAILS[email]!));
            user.email = new Email(email);
            return user;
          });
      }

      return valuesOf(data.query, "_id")
        .filter((id: string): boolean => {
          return [ANA, BEN, STRANGER].includes(id);
        })
        .map((id: string): User => {
          return new User(new ObjectID(id));
        });
    }) as never,
  );

  findMembers = getJestSpyOn(
    ProjectMembership,
    "getMemberUserIds",
  ).mockImplementation((async (data: {
    userIds: Array<ObjectID | string>;
  }): Promise<Set<string>> => {
    return new Set<string>(
      data.userIds
        .map((id: ObjectID | string): string => {
          return id.toString().toLowerCase();
        })
        .filter((id: string): boolean => {
          return members.includes(id);
        }),
    );
  }) as never);

  // The project's teams, as the step may read them.
  findTeams = getJestSpyOn(TeamService, "findBy").mockImplementation(
    (async (data: { query: Record<string, unknown> }): Promise<Array<Team>> => {
      return valuesOf(data.query, "_id")
        .filter((id: string): boolean => {
          return id === PLATFORM_TEAM;
        })
        .map((id: string): Team => {
          return new Team(new ObjectID(id));
        });
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("the owner settings of Create One Incident and Create One Alert", () => {
  test("are its last two settings, optional: Owner Users picks people, Owner Teams teams", () => {
    for (const model of [new Incident(), new Alert()]) {
      const args: Array<Argument> = createOneOf(model)!.arguments;
      const last: Array<Argument> = args.slice(-2);

      expect(
        last.map((argument: Argument) => {
          return [argument.id, argument.name, argument.type, argument.required];
        }),
      ).toEqual([
        [
          OWNER_USERS_ARGUMENT_ID,
          "Owner Users",
          ComponentInputType.UserList,
          false,
        ],
        [
          OWNER_TEAMS_ARGUMENT_ID,
          "Owner Teams",
          ComponentInputType.TeamList,
          false,
        ],
      ]);

      // Saved workflows keep these ids, and the services read these keys.
      expect(OWNER_USERS_ARGUMENT_ID).toBe(OWNER_USERS_ON_CREATE_KEY);
      expect(OWNER_TEAMS_ARGUMENT_ID).toBe(OWNER_TEAMS_ON_CREATE_KEY);

      for (const argument of last) {
        expect(argument.description!.length).toBeLessThanOrEqual(150);
        expect(argument.description).toContain(
          model instanceof Incident ? "incident" : "alert",
        );
      }
    }
  });

  test("no other record's Create One has them", () => {
    let createOnes: number = 0;

    for (const modelType of Models) {
      const model: BaseModel = new modelType();
      const createOne: ComponentMetadata | undefined = createOneOf(model);

      if (!createOne) {
        continue;
      }

      createOnes++;

      const ids: Array<string> = createOne.arguments.map(
        (argument: Argument): string => {
          return argument.id;
        },
      );

      expect([
        model.tableName,
        ids.includes(OWNER_USERS_ARGUMENT_ID) ||
          ids.includes(OWNER_TEAMS_ARGUMENT_ID),
      ]).toEqual([
        model.tableName,
        TABLES_TAKING_OWNERS_ON_CREATE.includes(model.tableName || ""),
      ]);
    }

    expect(createOnes).toBeGreaterThan(20);
  });

  test("the step's help says who is told, what is asked of the step, and what is left out", () => {
    for (const model of [new Incident(), new Alert()]) {
      const createOne: ComponentMetadata = createOneOf(model)!;
      const documentation: ComponentDocumentation | null =
        getComponentDocumentation({
          metadata: createOne,
          stepId: "create-one-1",
        });

      const topic: ComponentDocumentationTopic | undefined = (
        documentation?.learnMore || []
      ).find((each: ComponentDocumentationTopic): boolean => {
        return each.title === "Who owns it from the start";
      });

      expect(topic).toBeDefined();

      const text: string = topic!.paragraphs.join(" ");

      expect(text).toContain("**Owner Users**");
      expect(text).toContain("**Owner Teams**");
      expect(text).toContain("created notification reaches them");
      expect(text).toContain("as a Project Admin of this project");
      expect(text).toContain("the run's log says so");
    }

    // A record whose create takes no owners has no such help.
    const maintenance: ComponentDocumentation | null =
      getComponentDocumentation({
        metadata: createOneOf(new ScheduledMaintenance())!,
        stepId: "create-one-1",
      });

    expect(
      (maintenance?.learnMore || []).some(
        (each: ComponentDocumentationTopic): boolean => {
          return each.title === "Who owns it from the start";
        },
      ),
    ).toBe(false);
  });
});

describe("Create One Incident and Create One Alert with owners", () => {
  test("hand the people and teams picked to the create, as its misc data - the REST create's ownerUsers and ownerTeams", async () => {
    const step: StepRun = await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_USERS_ARGUMENT_ID]: [ANA, BEN],
      [OWNER_TEAMS_ARGUMENT_ID]: [PLATFORM_TEAM],
    });

    expect(step.result.executePort?.id).toBe("success");

    const createBy: Handed = handed(createIncident);

    expect(Object.keys(createBy.miscDataProps || {}).sort()).toEqual([
      OWNER_TEAMS_ON_CREATE_KEY,
      OWNER_USERS_ON_CREATE_KEY,
    ]);
    expect(idsIn(createBy.miscDataProps![OWNER_USERS_ON_CREATE_KEY])).toEqual([
      ANA,
      BEN,
    ]);
    expect(idsIn(createBy.miscDataProps![OWNER_TEAMS_ON_CREATE_KEY])).toEqual([
      PLATFORM_TEAM,
    ]);
    expect(step.lines).toEqual([]);
  });

  test("an alert's too", async () => {
    const step: StepRun = await runAlertStep({
      json: { title: "CPU is high" },
      [OWNER_USERS_ARGUMENT_ID]: [ANA],
      [OWNER_TEAMS_ARGUMENT_ID]: [PLATFORM_TEAM],
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(
      idsIn(handed(createAlert).miscDataProps![OWNER_USERS_ON_CREATE_KEY]),
    ).toEqual([ANA]);
    expect(
      idsIn(handed(createAlert).miscDataProps![OWNER_TEAMS_ON_CREATE_KEY]),
    ).toEqual([PLATFORM_TEAM]);
  });

  test("the create is made as the step - a Project Admin of the project, never root - so the service asks about the owners as it asks the REST create's", async () => {
    await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_USERS_ARGUMENT_ID]: [ANA],
    });

    const props: DatabaseCommonInteractionProps = handed(createIncident).props;

    expect(props.isRoot).toBeFalsy();
    expect(props.userType).toBe(UserType.Workflow);
    expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());

    // Teams are read as the step reads them, in its project.
    await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_TEAMS_ARGUMENT_ID]: [PLATFORM_TEAM],
    });

    const teamRead: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = findTeams.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(teamRead.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
    expect(teamRead.props.isRoot).toBeFalsy();
    expect(teamRead.props.userType).toBe(UserType.Workflow);
  });

  test("an incident declared from a template takes the owners too, beside the template's", async () => {
    const step: StepRun = await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      [OWNER_USERS_ARGUMENT_ID]: [ANA],
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(createIncident).not.toHaveBeenCalled();

    const data: Handed & { templateId: ObjectID } = fromTemplate.mock
      .calls[0]![0] as Handed & { templateId: ObjectID };

    expect(data.templateId.toString()).toBe(TEMPLATE_ID);
    expect(idsIn(data.miscDataProps![OWNER_USERS_ON_CREATE_KEY])).toEqual([
      ANA,
    ]);
  });

  test("finds people by email address, from an earlier step's text or list, among the project's members", async () => {
    const step: StepRun = await runIncidentStep({
      json: { title: "Checkout is down" },
      // What an earlier step's value comes to: a line of ids and addresses, a JSON list, records.
      [OWNER_USERS_ARGUMENT_ID]: [
        `BEN@acme.test; ${ANA.toUpperCase()}`,
        JSON.stringify([ANA]),
        { _id: BEN } as unknown as string,
      ],
    } as JSONObject);

    expect(step.result.executePort?.id).toBe("success");
    expect(
      idsIn(handed(createIncident).miscDataProps![OWNER_USERS_ON_CREATE_KEY]),
    ).toEqual([ANA, BEN]);
    expect(step.lines).toEqual([]);

    // Members only, asked of the project in question.
    expect(
      (findMembers.mock.calls[0]![0] as { projectId: ObjectID }).projectId,
    ).toEqual(PROJECT_ID);
  });

  test("leaves out - and says so - who is no member of this project, by ID or email address, and what is not an ID or an address", async () => {
    const step: StepRun = await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_USERS_ARGUMENT_ID]: [
        ANA,
        STRANGER,
        STRANGER_EMAIL,
        "nobody@acme.test",
        "Jane",
      ],
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(
      idsIn(handed(createIncident).miscDataProps![OWNER_USERS_ON_CREATE_KEY]),
    ).toEqual([ANA]);
    expect(step.lines).toEqual([
      `Owner Users also held "Jane", which is not a user's ID or email address: left out.`,
      `Owner Users: no member of this project has the ID or email address "${STRANGER}", "${STRANGER_EMAIL}", "nobody@acme.test": left out.`,
    ]);
  });

  test("leaves out - and says so - a team that is not one of this project's, and what is not a team's ID", async () => {
    const step: StepRun = await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_TEAMS_ARGUMENT_ID]: [
        PLATFORM_TEAM,
        OTHER_PROJECTS_TEAM,
        "platform@acme.test",
      ],
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(
      idsIn(handed(createIncident).miscDataProps![OWNER_TEAMS_ON_CREATE_KEY]),
    ).toEqual([PLATFORM_TEAM]);
    expect(handed(createIncident).miscDataProps).not.toHaveProperty(
      OWNER_USERS_ON_CREATE_KEY,
    );
    expect(step.lines).toEqual([
      `Owner Teams also held "platform@acme.test", which is not a team's ID: left out.`,
      `Owner Teams: no team of this project has the ID "${OTHER_PROJECTS_TEAM}": left out.`,
    ]);
  });

  test("with nobody found, or nobody named, hands no owners over: the project's owners are told, as before", async () => {
    await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_USERS_ARGUMENT_ID]: [STRANGER],
      [OWNER_TEAMS_ARGUMENT_ID]: [],
    });

    expect(handed(createIncident).miscDataProps).toBeUndefined();

    createIncident.mockClear();
    findUsers.mockClear();

    await runIncidentStep({ json: { title: "Checkout is down" } });

    expect(handed(createIncident).miscDataProps).toBeUndefined();
    expect(findUsers).not.toHaveBeenCalled();
    expect(findTeams).not.toHaveBeenCalled();
  });

  test(`hands over at most ${MAX_OWNERS_ON_CREATE} of each, the first named, and says how many were left out`, async () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < MAX_OWNERS_ON_CREATE + 5; index++) {
      many.push(
        `8d000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
      );
    }

    members = many;
    findUsers.mockImplementation((async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<User>> => {
      return valuesOf(data.query, "_id").map((id: string): User => {
        return new User(new ObjectID(id));
      });
    }) as never);

    const step: StepRun = await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_USERS_ARGUMENT_ID]: many,
    });

    expect(
      idsIn(handed(createIncident).miscDataProps![OWNER_USERS_ON_CREATE_KEY]),
    ).toEqual(many.slice(0, MAX_OWNERS_ON_CREATE));
    expect(step.lines).toEqual([
      `Owner Users named ${MAX_OWNERS_ON_CREATE + 5}: the first ${MAX_OWNERS_ON_CREATE} are owners, the rest left out.`,
    ]);
  });

  test("owners the step may not add refuse the create - nothing is saved - and the step takes Error, saying why", async () => {
    // As the service's onBeforeCreate refuses them (OwnerRuleAssignment.checkOwnersPickedOnCreate).
    createIncident.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to add owners to this incident.",
      ) as never,
    );

    const step: StepRun = await runIncidentStep({
      json: { title: "Checkout is down" },
      [OWNER_USERS_ARGUMENT_ID]: [ANA],
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(
      step.lines.some((line: string): boolean => {
        return line.includes(
          "You do not have permission to add owners to this incident.",
        );
      }),
    ).toBe(true);
  });

  test("a record whose create takes no owners hands none over, whatever its settings hold", async () => {
    const step: StepRun = await run(
      new CreateOneBaseModel<ScheduledMaintenance>(ScheduledMaintenanceService),
      {
        json: { title: "Database upgrade" },
        [OWNER_USERS_ARGUMENT_ID]: [ANA],
      },
    );

    expect(step.result.executePort?.id).toBe("success");
    expect(handed(createMaintenance).miscDataProps).toBeUndefined();
    expect(findUsers).not.toHaveBeenCalled();
  });
});
