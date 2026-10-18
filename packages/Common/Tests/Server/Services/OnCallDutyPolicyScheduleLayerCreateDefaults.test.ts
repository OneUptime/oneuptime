import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

// @CaptureSpan logs the stack of every refusal.
jest.mock("../../../Server/Utils/Logger");

/*
 * A LAYER CREATED WITHOUT A ROTATION OR RESTRICTION TIMES STARTS WITH THE
 * ONES EVERY NEW LAYER STARTS WITH.
 *
 * Both columns are required, and the dashboard always sends them
 * (ScheduleLayerDefaults.buildNewScheduleLayer). An API client need not: the
 * Terraform provider has both optional, as the API's schema does, so a layer
 * written without restriction times failed at apply with "restrictionTimes
 * is required" (OneUptime/terraform-provider-oneuptime#13), and one without
 * a rotation with "rotation is required". Left out, or sent as null, they
 * now take the new-layer defaults: a weekly hand-off, on call around the
 * clock. These drive the real create - its hooks, permission checks and
 * required-field check - over an in-memory table.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("1d000000-0000-4000-8000-000000000002");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000003",
);

// A project admin, the way a project API key with that role asks.
function adminProps(): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.ProjectAdmin,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
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

// A layer with everything the API requires besides the two columns.
function layer(columns: {
  rotation?: Recurring | null;
  restrictionTimes?: RestrictionTimes | null;
}): OnCallDutyPolicyScheduleLayer {
  const model: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();

  model.onCallDutyPolicyScheduleId = SCHEDULE_ID;
  model.name = "Business hours";
  model.startsAt = new Date("2026-08-17T07:00:00.000Z");
  model.handOffTime = new Date("2026-08-24T07:00:00.000Z");

  for (const [column, value] of Object.entries(columns)) {
    (model as unknown as StoredRow)[column] = value;
  }

  return model;
}

function rotationOf(row: StoredRow): Recurring {
  const value: unknown = row["rotation"];
  return value instanceof Recurring ? value : Recurring.fromJSON(value as any);
}

function restrictionTimesOf(row: StoredRow): RestrictionTimes {
  const value: unknown = row["restrictionTimes"];
  return value instanceof RestrictionTimes
    ? value
    : RestrictionTimes.fromJSON(value as any);
}

describe("OnCallDutyPolicyScheduleLayerService.create", () => {
  let table: InMemoryTable;

  beforeEach(() => {
    table = useInMemoryTable(OnCallDutyPolicyScheduleLayerService, []);
    stubProjectDirectory({});

    // The schedule's roster is worked out elsewhere; not under test.
    getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "propagateShiftConfigChange",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a layer sent without either hands off weekly and is on call around the clock", async () => {
    await OnCallDutyPolicyScheduleLayerService.create({
      data: layer({}),
      props: adminProps(),
    });

    expect(table.inserts).toHaveLength(1);

    const rotation: Recurring = rotationOf(table.inserts[0]!);
    expect(rotation.intervalType).toBe(EventInterval.Week);
    expect(rotation.intervalCount.toNumber()).toBe(1);

    const restrictionTimes: RestrictionTimes = restrictionTimesOf(
      table.inserts[0]!,
    );
    expect(restrictionTimes.restictionType).toBe(RestrictionType.None);
    expect(restrictionTimes.dayRestrictionTimes).toBeNull();
    expect(restrictionTimes.weeklyRestrictionTimes).toEqual([]);
  });

  test("a layer sent with both as null gets the same defaults", async () => {
    await OnCallDutyPolicyScheduleLayerService.create({
      data: layer({ rotation: null, restrictionTimes: null }),
      props: adminProps(),
    });

    expect(rotationOf(table.inserts[0]!).intervalType).toBe(EventInterval.Week);
    expect(restrictionTimesOf(table.inserts[0]!).restictionType).toBe(
      RestrictionType.None,
    );
  });

  test("a layer sent with both keeps them", async () => {
    const rotation: Recurring = new Recurring();
    rotation.intervalType = EventInterval.Day;
    rotation.intervalCount = new PositiveNumber(2);

    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    restrictionTimes.weeklyRestrictionTimes = [
      {
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Friday,
        startTime: new Date("2026-08-17T07:00:00.000Z"),
        endTime: new Date("2026-08-17T16:00:00.000Z"),
      },
    ];

    await OnCallDutyPolicyScheduleLayerService.create({
      data: layer({ rotation, restrictionTimes }),
      props: adminProps(),
    });

    const stored: StoredRow = table.inserts[0]!;
    expect(rotationOf(stored).intervalType).toBe(EventInterval.Day);
    expect(rotationOf(stored).intervalCount.toNumber()).toBe(2);
    expect(restrictionTimesOf(stored).restictionType).toBe(
      RestrictionType.Weekly,
    );
    expect(restrictionTimesOf(stored).weeklyRestrictionTimes).toHaveLength(1);
  });

  test("each default is the layer's own: changing one changes no other layer's", async () => {
    await OnCallDutyPolicyScheduleLayerService.create({
      data: layer({}),
      props: adminProps(),
    });
    await OnCallDutyPolicyScheduleLayerService.create({
      data: layer({}),
      props: adminProps(),
    });

    expect(rotationOf(table.inserts[0]!)).not.toBe(
      rotationOf(table.inserts[1]!),
    );
    expect(restrictionTimesOf(table.inserts[0]!)).not.toBe(
      restrictionTimesOf(table.inserts[1]!),
    );
  });
});
