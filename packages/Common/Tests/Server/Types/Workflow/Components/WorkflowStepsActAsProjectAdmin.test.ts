import IncidentFeed from "../../../../../Models/DatabaseModels/IncidentFeed";
import Label from "../../../../../Models/DatabaseModels/Label";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import SmsLog from "../../../../../Models/DatabaseModels/SmsLog";
import Team from "../../../../../Models/DatabaseModels/Team";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DeleteManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteManyBaseModel";
import DeleteOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import UserType from "../../../../../Types/UserType";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../../Spy";
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
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../../../Server/Utils/Logger");

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
 * EVERY KIND OF WORKFLOW STEP ACTS AS A PROJECT ADMIN OF ITS PROJECT.
 *
 * Create, Update, Delete and Find, One and Many, and the model-event
 * triggers run here over DatabaseService's real checks - table, column,
 * plan and tenant - with the database left out: a write stops just before
 * it would be written, and a read is answered with the rows given. For each
 * kind:
 *
 *  - what a Project Admin may do passes, in the workflow's project only;
 *  - what only an owner may do, or nobody but OneUptime itself, is refused,
 *    and the run log says so in plain words, naming the step;
 *  - what the project's plan does not include is refused with the plan's
 *    name, and passes on a plan that includes it.
 *
 * Billing is on (as on OneUptime Cloud) with the plans this suite sets in
 * the environment; the project's plan is what ProjectService answers.
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
  "7b000000-0000-4000-8000-000000000001",
);
const RECORD_ID: string = "7b000000-0000-4000-8000-0000000000a1";

class PastTheChecks extends Error {
  public constructor() {
    super("Every check passed; the write would be made now.");
  }
}

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

let projectPlan: PlanType = PlanType.Enterprise;
let currentPlanSpy: SpyInstance;
const savedPlanEnvironment: Record<string, string | undefined> = {};

function options(lines: Array<string>): RunOptions {
  return {
    log: ((line: unknown): void => {
      lines.push(typeof line === "string" ? line : JSON.stringify(line));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Nightly clean-up",
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

async function run(
  component: ComponentCode,
  args: JSONObject,
): Promise<StepRun> {
  const lines: Array<string> = [];
  const result: RunReturnType = await component.run(args, options(lines));
  return { result, lines };
}

function refusedLine(step: ComponentCode, lines: Array<string>): string {
  const title: string = step.getMetadata().title;
  const line: string | undefined = lines.find((candidate: string) => {
    return candidate.startsWith(`"${title}" was refused`);
  });

  expect(line).toBeDefined();

  return line!;
}

function expectNotRefused(lines: Array<string>): void {
  expect(
    lines.filter((line: string) => {
      return line.includes("was refused");
    }),
  ).toEqual([]);
}

/*
 * A service of `modelType` whose creates stop just before the insert, once
 * every check has passed, recording the row they would insert.
 */
function stopBeforeInsert<TBaseModel extends BaseModel>(modelType: {
  new (): TBaseModel;
}): {
  service: DatabaseService<TBaseModel>;
  inserted: () => Record<string, unknown> | undefined;
} {
  const service: DatabaseService<TBaseModel> = new DatabaseService<TBaseModel>(
    modelType,
  );
  let row: Record<string, unknown> | undefined = undefined;

  // The unique-value checks find no clash, without a database.
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "assertCreateWillInsert").mockImplementation(((
    data: unknown,
  ): never => {
    row = { ...(data as Record<string, unknown>) };
    throw new PastTheChecks();
  }) as never);

  return {
    service,
    inserted: (): Record<string, unknown> | undefined => {
      return row;
    },
  };
}

/*
 * A service of `modelType` whose updates stop once every check has passed
 * (onUpdatePermitted), recording what they would write and where.
 */
function stopBeforeUpdate<TBaseModel extends BaseModel>(modelType: {
  new (): TBaseModel;
}): {
  service: DatabaseService<TBaseModel>;
  permitted: () => { query: JSONObject; data: JSONObject } | undefined;
} {
  const service: DatabaseService<TBaseModel> = new DatabaseService<TBaseModel>(
    modelType,
  );
  let permitted: { query: JSONObject; data: JSONObject } | undefined =
    undefined;

  getJestSpyOn(service, "onUpdatePermitted").mockImplementation(((updateBy: {
    query: JSONObject;
    data: JSONObject;
  }): never => {
    permitted = { query: updateBy.query, data: { ...updateBy.data } };
    throw new PastTheChecks();
  }) as never);

  return {
    service,
    permitted: (): { query: JSONObject; data: JSONObject } | undefined => {
      return permitted;
    },
  };
}

/*
 * A service of `modelType` whose deletes stop once every check has passed:
 * at the read of the rows they would delete, recording its query.
 */
function stopBeforeDelete<TBaseModel extends BaseModel>(modelType: {
  new (): TBaseModel;
}): {
  service: DatabaseService<TBaseModel>;
  reached: () => JSONObject | undefined;
} {
  const service: DatabaseService<TBaseModel> = new DatabaseService<TBaseModel>(
    modelType,
  );
  let query: JSONObject | undefined = undefined;

  getJestSpyOn(service, "_findBy").mockImplementation(((findBy: {
    query: JSONObject;
  }): never => {
    query = findBy.query;
    throw new PastTheChecks();
  }) as never);

  return {
    service,
    reached: (): JSONObject | undefined => {
      return query;
    },
  };
}

type FindMock = Mock<
  (options: Record<string, unknown>) => Promise<Array<BaseModel>>
>;

// A service of `modelType` whose reads are answered with `rows`.
function answeringReads<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  rows: Array<BaseModel>,
): { service: DatabaseService<TBaseModel>; find: FindMock } {
  const service: DatabaseService<TBaseModel> = new DatabaseService<TBaseModel>(
    modelType,
  );
  const find: FindMock = jest.fn(async (): Promise<Array<BaseModel>> => {
    return rows;
  });

  getJestSpyOn(service, "getRepository").mockReturnValue({ find } as never);

  return { service, find };
}

/*
 * The project a query was scoped to: its id, or a raw match on it once the
 * permission checks have written the query.
 */
function tenantOf(where: unknown): string {
  const projectId: unknown = (where as Record<string, unknown> | undefined)?.[
    "projectId"
  ];
  const parameters: Record<string, unknown> | undefined = (
    projectId as { _objectLiteralParameters?: Record<string, unknown> }
  )?._objectLiteralParameters;

  if (parameters) {
    return Object.values(parameters).map(String).join(",");
  }

  return String(projectId);
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

  currentPlanSpy = getJestSpyOn(ProjectService, "getCurrentPlan");
  currentPlanSpy.mockImplementation((async () => {
    return { plan: projectPlan, isSubscriptionUnpaid: false };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("Create One and Create Many", () => {
  test("a create a Project Admin may make passes, in the workflow's project, by no person", async () => {
    const { service, inserted } = stopBeforeInsert(Label);

    const step: StepRun = await run(new CreateOneBaseModel<Label>(service), {
      json: { name: "payments", color: "#4f46e5" },
    });

    expectNotRefused(step.lines);
    expect(inserted()?.["name"]).toBe("payments");
    expect(String(inserted()?.["projectId"])).toBe(PROJECT_ID.toString());
    expect(inserted()?.["createdByUserId"]).toBeUndefined();
    expect(currentPlanSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("Create Many makes each create as the same Project Admin", async () => {
    const { service, inserted } = stopBeforeInsert(Label);

    const step: StepRun = await run(new CreateManyBaseModel<Label>(service), {
      "json-array": [{ name: "payments", color: "#4f46e5" }],
    });

    expectNotRefused(step.lines);
    expect(String(inserted()?.["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("a create the plan does not include is refused with the plan's name, and passes on it", async () => {
    projectPlan = PlanType.Free;

    const refused: ReturnType<typeof stopBeforeInsert<Label>> =
      stopBeforeInsert(Label);
    const component: CreateOneBaseModel<Label> = new CreateOneBaseModel<Label>(
      refused.service,
    );
    const step: StepRun = await run(component, {
      json: { name: "payments", color: "#4f46e5" },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(refusedLine(component, step.lines)).toContain(
      "because of this project's plan: Please upgrade your plan to Growth",
    );
    expect(refused.inserted()).toBeUndefined();

    projectPlan = PlanType.Growth;

    const allowed: ReturnType<typeof stopBeforeInsert<Label>> =
      stopBeforeInsert(Label);
    const onPlan: StepRun = await run(
      new CreateOneBaseModel<Label>(allowed.service),
      { json: { name: "payments", color: "#4f46e5" } },
    );

    expectNotRefused(onPlan.lines);
    expect(allowed.inserted()).toBeDefined();
  });

  test("a record only OneUptime writes cannot be created by a step", async () => {
    const { service, inserted } = stopBeforeInsert(SmsLog);
    const component: CreateOneBaseModel<SmsLog> =
      new CreateOneBaseModel<SmsLog>(service);

    const step: StepRun = await run(component, {
      json: { toNumber: "+15555550123", smsText: "Paged." },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(refusedLine(component, step.lines)).toContain(
      "Workflow steps can do what a Project Admin of this project can do",
    );
    expect(inserted()).toBeUndefined();
  });

  test("a value only OneUptime sets is refused, even on a record a step may create", async () => {
    const { service, inserted } = stopBeforeInsert(Team);
    const component: CreateOneBaseModel<Team> = new CreateOneBaseModel<Team>(
      service,
    );

    const step: StepRun = await run(component, {
      json: { name: "Responders", isTeamDeleteable: false },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(refusedLine(component, step.lines)).toContain("isTeamDeleteable");
    expect(inserted()).toBeUndefined();
  });
});

describe("Update One and Update Many", () => {
  test("an update a Project Admin may make passes, scoped to the workflow's project", async () => {
    const { service, permitted } = stopBeforeUpdate(Label);

    const step: StepRun = await run(new UpdateOneBaseModel<Label>(service), {
      query: { _id: RECORD_ID },
      data: { name: "payments-api" },
    });

    expectNotRefused(step.lines);
    expect(permitted()?.data["name"]).toBe("payments-api");
    expect(permitted()?.data["projectId"]).toBeUndefined();
    expect(tenantOf(permitted()?.query)).toBe(PROJECT_ID.toString());
  });

  test("an update the plan does not include is refused with the plan's name", async () => {
    projectPlan = PlanType.Free;

    const { service, permitted } = stopBeforeUpdate(Label);
    const component: UpdateManyBaseModel<Label> =
      new UpdateManyBaseModel<Label>(service);

    const step: StepRun = await run(component, {
      query: { name: "payments" },
      data: { description: "Payments services" },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(refusedLine(component, step.lines)).toContain(
      "Please upgrade your plan to Growth",
    );
    expect(permitted()).toBeUndefined();
  });

  test("a value only OneUptime sets cannot be changed by a step", async () => {
    const { service, permitted } = stopBeforeUpdate(Team);
    const component: UpdateOneBaseModel<Team> = new UpdateOneBaseModel<Team>(
      service,
    );

    const step: StepRun = await run(component, {
      query: { _id: RECORD_ID },
      data: { isTeamEditable: true },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(refusedLine(component, step.lines)).toContain("isTeamEditable");
    expect(permitted()).toBeUndefined();
  });

  test("a feed entry stays as it was written", async () => {
    const { service, permitted } = stopBeforeUpdate(IncidentFeed);
    const component: UpdateManyBaseModel<IncidentFeed> =
      new UpdateManyBaseModel<IncidentFeed>(service);

    const step: StepRun = await run(component, {
      query: { _id: RECORD_ID },
      data: { feedInfoInMarkdown: "Rewritten" },
    });

    expect(step.result.executePort?.id).toBe("error");
    refusedLine(component, step.lines);
    expect(permitted()).toBeUndefined();
  });
});

describe("Delete One and Delete Many", () => {
  test("a delete a Project Admin may make passes, scoped to the workflow's project", async () => {
    const { service, reached } = stopBeforeDelete(Label);

    const step: StepRun = await run(new DeleteOneBaseModel<Label>(service), {
      query: { _id: RECORD_ID },
    });

    expectNotRefused(step.lines);
    expect(reached()).toBeDefined();
    expect(tenantOf(reached())).toBe(PROJECT_ID.toString());
  });

  test("a feed entry cannot be deleted by a step", async () => {
    const { service, reached } = stopBeforeDelete(IncidentFeed);
    const component: DeleteManyBaseModel<IncidentFeed> =
      new DeleteManyBaseModel<IncidentFeed>(service);

    const step: StepRun = await run(component, {
      query: { _id: RECORD_ID },
    });

    expect(step.result.executePort?.id).toBe("error");
    refusedLine(component, step.lines);
    expect(reached()).toBeUndefined();
  });
});

describe("Find One and Find Many", () => {
  test("a read a Project Admin may make passes, scoped to the workflow's project", async () => {
    const label: Label = new Label();
    label._id = RECORD_ID;
    label.name = "payments";

    const { service, find } = answeringReads(Label, [label]);

    const step: StepRun = await run(new FindManyBaseModel<Label>(service), {
      query: {},
      select: { name: true },
      limit: 10,
      skip: 0,
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(
      (step.result.returnValues["models"] as Array<JSONObject>)[0]?.["name"],
    ).toBe("payments");
    expect(tenantOf(find.mock.calls[0]![0]["where"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a column only an owner may read is refused, naming the step", async () => {
    const { service, find } = answeringReads(Probe, []);
    const component: FindOneBaseModel<Probe> = new FindOneBaseModel<Probe>(
      service,
    );

    const step: StepRun = await run(component, {
      query: { _id: RECORD_ID },
      select: { name: true, createdByUser: { _id: true, email: true } },
    });

    expect(step.result.executePort?.id).toBe("error");
    refusedLine(component, step.lines);
    expect(find).not.toHaveBeenCalled();
  });
});

describe("the model-event triggers", () => {
  test("read the record in the workflow's project only: another project's is not found", async () => {
    // What the database answers to a read scoped to the workflow's project.
    const { service, find } = answeringReads(Label, []);
    const trigger: OnTriggerBaseModel<Label> = new OnTriggerBaseModel<Label>(
      service,
      "on-update",
    );

    await expect(
      trigger.run(
        { data: { _id: RECORD_ID }, select: { name: true } },
        options([]),
      ),
    ).rejects.toThrow(`Model not found with id ${RECORD_ID}`);

    expect(tenantOf(find.mock.calls[0]![0]["where"])).toBe(
      PROJECT_ID.toString(),
    );
  });
});

describe("the props a step acts with", () => {
  test("name the workflow and no person, and carry the project's plan", async () => {
    const service: DatabaseService<Label> = new DatabaseService<Label>(Label);
    const findBy: SpyInstance = getJestSpyOn(service, "findBy");
    findBy.mockResolvedValue([] as never);

    await run(new FindManyBaseModel<Label>(service), {
      query: {},
      select: { name: true },
      limit: 10,
      skip: 0,
    });

    const props: DatabaseCommonInteractionProps = (
      findBy.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;

    expect(props.userType).toBe(UserType.Workflow);
    expect(props.userId).toBeUndefined();
    expect(props.isRoot).toBeUndefined();
    expect(props.workflowName).toBe("Nightly clean-up");
    expect(props.tenantId).toBe(PROJECT_ID);
    expect(props.currentPlan).toBe(PlanType.Enterprise);
  });
});
