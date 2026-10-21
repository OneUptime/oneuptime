import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import PayAsYouGoBillingService from "../../../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ActiveMonitorLimit from "../../../../../Server/Utils/Billing/ActiveMonitorLimit";
import MonitorStepsProjectValidator from "../../../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { useInMemoryTable } from "../../../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

// The refusal below is deliberate; the component logs it to the server log too.
jest.mock("../../../../../Server/Utils/Logger");

/*
 * A WORKFLOW'S CREATE MONITOR STEP, AT THE PROJECT'S ACTIVE MONITOR LIMIT.
 *
 * A workflow makes monitors through the same MonitorService.create as every
 * other path, as a Project Admin of its project, so the plan's limit holds
 * there too: the step takes its error port, nothing is written, and the
 * run's log says why in the limit's own words - which limit, how many the
 * project has, and what to do - so whoever reads the run knows it was the
 * plan, not the workflow.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

interface StepRun {
  result: RunReturnType;
  lines: Array<string>;
}

async function runCreateMonitorStep(): Promise<StepRun> {
  const lines: Array<string> = [];

  const options: RunOptions = {
    log: ((line: unknown): void => {
      lines.push(String(line));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  const result: RunReturnType = await new CreateOneBaseModel<Monitor>(
    MonitorService,
  ).run(
    {
      json: {
        name: "Checkout API",
        monitorType: MonitorType.IncomingRequest,
      },
    },
    options,
  );

  return { result: result, lines: lines };
}

describe("a workflow's Create Monitor step", () => {
  let monitors: ReturnType<typeof useInMemoryTable>;

  beforeEach(() => {
    setTestBillingEnabled(true);
    monitors = useInMemoryTable(MonitorService, []);

    // The support report's project: a plan of 500, with 2,881 active monitors.
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 500,
    });
    jest
      .spyOn(ActiveMonitorLimit, "countActiveMonitors")
      .mockResolvedValue(2881);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);

    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(MonitorService, "validateDependencyConfiguration")
      .mockResolvedValue(undefined);
    const status: MonitorStatus = new MonitorStatus();
    status.id = ObjectID.generate();
    jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(status);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  test("past the limit, takes its error port, writes nothing, and the run's log says why in the limit's words", async () => {
    const run: StepRun = await runCreateMonitorStep();

    expect(run.result.executePort?.id).toBe("error");
    expect(monitors.inserts).toEqual([]);
    expect(run.lines).toContain(
      "This project has 2,881 active monitors and its plan includes 500, so no more can be added until it has fewer than 500. All of its monitors keep running. Delete monitors you no longer need, or change the plan in Project Settings > Billing and Invoices > Billing. Manual monitors do not count towards the limit; monitors that are turned off or archived do.",
    );
  });

  test("the limit is asked of the workflow's own project", async () => {
    await runCreateMonitorStep();

    expect(ActiveMonitorLimit.countActiveMonitors).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });
  });
});
