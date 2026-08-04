import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ProjectService from "../../../Server/Services/ProjectService";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A monitor's initial currentMonitorStatusId is set in
 * MonitorService.onBeforeCreate from the project's operational status. A
 * project may hold MORE than one operational state (a user - or a Terraform
 * fixture - can add another `isOperationalState: true` status), so this lookup
 * must be DETERMINISTIC.
 *
 * Regression: the lookup carried no explicit sort, so findOneBy fell back to
 * `createdAt DESC` and returned whichever operational status was created most
 * recently. A monitor created right after a caller added a custom operational
 * status silently adopted THAT status; when the custom status was later deleted
 * while the monitor still pointed at it, the currentMonitorStatusId foreign key
 * (ON DELETE NO ACTION) blocked the delete forever. This is the intermittent
 * "Monitor records still reference it" failure in the Terraform E2E suite,
 * where the monitors latched onto the fixture's freshly-created "TF Operational"
 * instead of the seeded default.
 *
 * The fix orders the lookup by priority ascending (the seeded default
 * operational status is priority 0) then createdAt ascending, so a monitor
 * always adopts the project's canonical operational status. These tests pin
 * that ordering and the resulting assignment.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEFAULT_OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

describe("MonitorService.onBeforeCreate operational status selection", () => {
  let findOneByMock: MockFunction;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    // The monitorSteps project-scope validator needs a DB; it is not under test.
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined as never);

    // Billing gate needs a DB; return a plan that passes both checks.
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      isFreePlan: false,
    } as never);

    // Capture the query/sort the operational-status lookup is made with.
    findOneByMock = getJestMockFunction();
    findOneByMock.mockImplementation(() => {
      const status: MonitorStatus = new MonitorStatus();
      status.id = DEFAULT_OPERATIONAL_STATUS_ID;
      return Promise.resolve(status);
    });
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockImplementation(findOneByMock as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runOnBeforeCreate: () => Promise<Monitor> =
    async (): Promise<Monitor> => {
      const monitor: Monitor = new Monitor();
      monitor.monitorType = MonitorType.Manual;

      const createBy: CreateBy<Monitor> = {
        data: monitor,
        props: { isRoot: true, tenantId: PROJECT_ID },
      } as CreateBy<Monitor>;

      await (
        MonitorService as unknown as {
          onBeforeCreate: (c: CreateBy<Monitor>) => Promise<unknown>;
        }
      ).onBeforeCreate(createBy);

      return createBy.data as Monitor;
    };

  test("selects the operational status with a deterministic priority-ascending sort", async () => {
    await runOnBeforeCreate();

    expect(findOneByMock).toHaveBeenCalledTimes(1);
    const findArg: FindOneBy<MonitorStatus> = findOneByMock.mock
      .calls[0]![0] as FindOneBy<MonitorStatus>;

    // Only operational states are considered.
    expect(
      (findArg.query as { isOperationalState?: boolean }).isOperationalState,
    ).toBe(true);

    /*
     * The sort must be explicit and deterministic. `priority` ascending picks
     * the primary operational status (the seeded default is priority 0);
     * without it findOneBy would fall back to createdAt DESC and grab the
     * newest operational status.
     */
    const sort: Partial<Record<string, SortOrder>> = findArg.sort as Partial<
      Record<string, SortOrder>
    >;
    expect(sort).toBeDefined();
    expect(sort["priority"]).toBe(SortOrder.Ascending);
    // createdAt ascending is the stable tie-breaker (oldest wins), never DESC.
    expect(sort["createdAt"]).toBe(SortOrder.Ascending);
    expect(sort["createdAt"]).not.toBe(SortOrder.Descending);
  });

  test("assigns the selected operational status as the monitor's currentMonitorStatusId", async () => {
    const monitor: Monitor = await runOnBeforeCreate();

    expect(monitor.currentMonitorStatusId?.toString()).toBe(
      DEFAULT_OPERATIONAL_STATUS_ID.toString(),
    );
  });
});
