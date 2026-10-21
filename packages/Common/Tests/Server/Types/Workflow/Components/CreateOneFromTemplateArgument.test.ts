import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../../../Types/Workflow/CreateFromTemplate";
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
 * HOW A CREATE ONE STEP READS ITS TEMPLATE SETTING.
 *
 * Create One Incident hands a picked Incident Template to
 * IncidentService.createFromTemplate, as the step, with JSON Object as what
 * should differ from the template - or nothing. Without one it creates the
 * incident from JSON Object, as it always did. The declaration itself runs
 * over the real service in IncidentCreateFromTemplate.test.ts; here the
 * service is stood in for, and only what the step hands it is read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const TEMPLATE_ID: string = "7d000000-0000-4000-8000-0000000000a1";

// The spy getJestSpyOn hands back.
type SpyInstance = ReturnType<typeof getJestSpyOn>;

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

let fromTemplate: SpyInstance;
let create: SpyInstance;

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

// What the step handed createFromTemplate.
function declared(): {
  templateId: ObjectID;
  data: Incident;
  props: DatabaseCommonInteractionProps;
} {
  return fromTemplate.mock.calls[0]![0] as {
    templateId: ObjectID;
    data: Incident;
    props: DatabaseCommonInteractionProps;
  };
}

beforeEach(() => {
  setTestBillingEnabled(true);

  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

  fromTemplate = getJestSpyOn(
    IncidentService,
    "createFromTemplate",
  ).mockImplementation((async (data: { data: Incident }) => {
    return data.data;
  }) as never);
  create = getJestSpyOn(IncidentService, "create").mockImplementation(
    (async (createBy: { data: Incident }) => {
      return createBy.data;
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("Create One Incident with an Incident Template picked", () => {
  test("declares the incident from it as the step, with nothing else to set", async () => {
    const step: StepRun = await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(create).not.toHaveBeenCalled();
    expect(fromTemplate).toHaveBeenCalledTimes(1);

    expect(declared().templateId.toString()).toBe(TEMPLATE_ID);
    expect(declared().data.projectId?.toString()).toBe(PROJECT_ID.toString());

    // A Project Admin of the workflow's project, on its plan - never root.
    expect(declared().props.isRoot).toBeFalsy();
    expect(declared().props.userType).toBe(UserType.Workflow);
    expect(declared().props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(declared().props.workflowId?.toString()).toBe(
      WORKFLOW_ID.toString(),
    );
    expect(declared().props.currentPlan).toBe(PlanType.Enterprise);
  });

  test("hands JSON Object over as what differs from the template", async () => {
    await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      json: { title: "Checkout is down in eu-west-1" },
    });

    expect(declared().data.title).toBe("Checkout is down in eu-west-1");
  });

  test("reads JSON Object written as text, as it always did", async () => {
    await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      json: '{"title": "Checkout is down"}',
    });

    expect(declared().data.title).toBe("Checkout is down");
  });

  test("takes the template's ID as picked, spaces around it left out", async () => {
    await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: `  ${TEMPLATE_ID}  `,
    });

    expect(declared().templateId.toString()).toBe(TEMPLATE_ID);
  });

  test("a setting that is not a template's ID takes the error port, naming the setting", async () => {
    const step: StepRun = await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: "checkout",
      json: { title: "Checkout is down" },
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(step.lines).toContain(
      'Incident Template must be the ID of a template, and "checkout" is not one. Pick the template from the list.',
    );
    expect(fromTemplate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("what the service refuses takes the error port, in its words", async () => {
    fromTemplate.mockRejectedValue(
      new BadDataException(
        "This incident references records that are not in this project.",
      ),
    );

    const step: StepRun = await runIncidentStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(step.lines).toContain(
      "This incident references records that are not in this project.",
    );
  });
});

describe("Create One Incident without a template", () => {
  test.each([
    ["no setting", {}],
    ["an empty one", { [INCIDENT_TEMPLATE_ARGUMENT_ID]: "" }],
    ["one of spaces", { [INCIDENT_TEMPLATE_ARGUMENT_ID]: "   " }],
  ] as Array<[string, JSONObject]>)(
    "%s: creates the incident from JSON Object, as before",
    async (_case: string, setting: JSONObject) => {
      const step: StepRun = await runIncidentStep({
        ...setting,
        json: { title: "Checkout is down" },
      });

      expect(step.result.executePort?.id).toBe("success");
      expect(fromTemplate).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledTimes(1);
      expect((create.mock.calls[0]![0] as { data: Incident }).data.title).toBe(
        "Checkout is down",
      );
    },
  );

  test("with no JSON Object either there is nothing to create", async () => {
    const step: StepRun = await runIncidentStep({});

    expect(step.result.executePort?.id).toBe("error");
    expect(step.lines).toContain("JSON is undefined.");
    expect(create).not.toHaveBeenCalled();
    expect(fromTemplate).not.toHaveBeenCalled();
  });
});

describe("a record with no templates", () => {
  test("Create One Label has no template setting, so one sent to it is not read", async () => {
    const service: DatabaseService<Label> = new DatabaseService<Label>(Label);
    const labelFromTemplate: SpyInstance = getJestSpyOn(
      service,
      "createFromTemplate",
    );
    const labelCreate: SpyInstance = getJestSpyOn(
      service,
      "create",
    ).mockImplementation((async (createBy: { data: Label }) => {
      return createBy.data;
    }) as never);

    const step: StepRun = await run(new CreateOneBaseModel<Label>(service), {
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
      json: { name: "payments", color: "#4f46e5" },
    });

    expect(step.result.executePort?.id).toBe("success");
    expect(labelFromTemplate).not.toHaveBeenCalled();
    expect(labelCreate).toHaveBeenCalledTimes(1);
  });

  test("still needs its JSON Object", async () => {
    const service: DatabaseService<Label> = new DatabaseService<Label>(Label);

    const step: StepRun = await run(new CreateOneBaseModel<Label>(service), {
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: TEMPLATE_ID,
    });

    expect(step.result.executePort?.id).toBe("error");
    expect(step.lines).toContain("JSON is undefined.");
  });
});
