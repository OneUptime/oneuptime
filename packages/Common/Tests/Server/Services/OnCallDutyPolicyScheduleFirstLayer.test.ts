import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { RestrictionType } from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A NEW ON-CALL SCHEDULE PUTS SOMEONE ON CALL FROM THE START.
 *
 * Create On-Call Schedule asks "Who takes turns?" and sends the picks as
 * misc data (firstLayerUsers, in the order they take turns, and
 * firstLayerRotation, how long each turn lasts). OnCallDutyPolicyScheduleService
 * .create then adds the schedule's first layer - "Layer 1", on call from
 * now - with those people in it, in that order. These tests drive the real
 * create override and the real permission checks, with only the database
 * stubbed:
 *
 *   - nobody picked: no layer, nothing extra read - as before;
 *   - somebody picked: one layer, created after the schedule exists, as the
 *     caller, then one layer user per person, in pick order;
 *   - what can be refused is refused before anything is saved: bad lists, a
 *     bad rotation, a caller who may not add layers or people to them, and
 *     people from outside the project;
 *   - what fails once the schedule is saved is logged, and the schedule is
 *     kept.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000002",
);
const LAYER_ID: ObjectID = new ObjectID("0c000000-0000-4000-8000-000000000003");
const CALLER_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000004",
);

const ALEX: string = "0c000000-0000-4000-8000-0000000000a1";
const SAM: string = "0c000000-0000-4000-8000-0000000000a2";
const PRIYA: string = "0c000000-0000-4000-8000-0000000000a3";

// Somebody who is not a member of the project.
const STRANGER: string = "0c000000-0000-4000-8000-0000000000f9";

// The base create as it is, taken before any test stubs it.
const REAL_BASE_CREATE: (
  this: DatabaseService<BaseModel>,
  createBy: CreateBy<BaseModel>,
) => Promise<BaseModel> = DatabaseService.prototype.create;

const MEMBERS: Array<string> = [ALEX, SAM, PRIYA, CALLER_ID.toString()];

const WEEK_IN_MS: number = 7 * 24 * 3600 * 1000;

function grant(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
  };
}

function callerProps(
  permissions: Array<Permission> = [Permission.OnCallMember],
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(grant),
      },
    },
  };
}

function newSchedule(): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.name = "Payments primary";
  schedule.timezone = Timezone.EuropeBerlin;
  return schedule;
}

function createSchedule(
  miscDataProps: JSONObject | undefined,
  props: DatabaseCommonInteractionProps = callerProps(),
  data: OnCallDutyPolicySchedule = newSchedule(),
): Promise<OnCallDutyPolicySchedule> {
  const createBy: CreateBy<OnCallDutyPolicySchedule> = { data, props };

  if (miscDataProps !== undefined) {
    createBy.miscDataProps = miscDataProps;
  }

  return OnCallDutyPolicyScheduleService.create(createBy);
}

function rotationOf(intervalType: EventInterval, count: number): Recurring {
  const rotation: Recurring = new Recurring();
  rotation.intervalType = intervalType;
  rotation.intervalCount = new PositiveNumber(count);
  return rotation;
}

// The ids a `userId IN (...)` query asks for.
function idsIn(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  const values: unknown = Object.values(parameters)[0];

  return Array.isArray(values)
    ? values.map((value: unknown): string => {
        return String(value).toLowerCase();
      })
    : [];
}

interface MembershipQuery {
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

let events: Array<string>;
let layerCreates: Array<CreateBy<OnCallDutyPolicyScheduleLayer>>;
let layerUserCreates: Array<CreateBy<OnCallDutyPolicyScheduleLayerUser>>;
let membershipQueries: Array<MembershipQuery>;
let layerCreateError: Error | null;
let failingUserIds: Array<string>;
let scheduleCreateSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

beforeEach(() => {
  events = [];
  layerCreates = [];
  layerUserCreates = [];
  membershipQueries = [];
  layerCreateError = null;
  failingUserIds = [];

  /*
   * Every create is stubbed at the base, after the real permission checks
   * the schedule service makes before it: the schedule's own create stands
   * for its hooks and its save; a layer and a layer user are recorded as
   * their services would be handed them.
   */
  scheduleCreateSpy = jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      if (this.modelType === OnCallDutyPolicySchedule) {
        events.push("schedule create started");
        await Promise.resolve();
        const schedule: OnCallDutyPolicySchedule =
          createBy.data as OnCallDutyPolicySchedule;
        schedule.id = SCHEDULE_ID;
        schedule.projectId = createBy.props.tenantId || schedule.projectId!;
        events.push("schedule created");
        return schedule;
      }

      if (this.modelType === OnCallDutyPolicyScheduleLayer) {
        events.push("layer created");
        layerCreates.push(createBy as CreateBy<OnCallDutyPolicyScheduleLayer>);

        if (layerCreateError) {
          throw layerCreateError;
        }

        createBy.data.id = LAYER_ID;
        return createBy.data;
      }

      if (this.modelType === OnCallDutyPolicyScheduleLayerUser) {
        const userId: string =
          (
            createBy.data as OnCallDutyPolicyScheduleLayerUser
          ).userId?.toString() || "";

        events.push(`layer user ${userId}`);
        layerUserCreates.push(
          createBy as CreateBy<OnCallDutyPolicyScheduleLayerUser>,
        );

        if (failingUserIds.includes(userId)) {
          throw new Error(`${userId} could not be added.`);
        }

        return createBy.data;
      }

      throw new Error(`Unexpected create of ${this.modelType.name}`);
    });

  jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation(async (request: any): Promise<Array<TeamMember>> => {
      membershipQueries.push({
        query: request.query,
        props: request.props,
      });

      // One row per team the person is in: two teams for each member.
      return idsIn(request.query.userId)
        .filter((id: string): boolean => {
          return MEMBERS.includes(id);
        })
        .flatMap((id: string): Array<TeamMember> => {
          return [0, 1].map((): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.userId = new ObjectID(id.toUpperCase());
            return member;
          });
        });
    });

  loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function scheduleWasSaved(): boolean {
  return events.includes("schedule create started");
}

function layerUserIds(): Array<string> {
  return layerUserCreates.map(
    (createBy: CreateBy<OnCallDutyPolicyScheduleLayerUser>): string => {
      return createBy.data.userId?.toString() || "";
    },
  );
}

describe("a schedule with nobody to take turns", () => {
  test.each([
    ["no misc data", undefined],
    ["empty misc data", {}],
    ["an empty list", { firstLayerUsers: [] }],
    ["other misc data only", { ownerUsers: [ALEX], users: [SAM] }],
    [
      "a rotation and nobody to rotate",
      {
        firstLayerRotation: rotationOf(EventInterval.Day, 1).toJSON(),
      },
    ],
  ] as Array<[string, JSONObject | undefined]>)(
    "%s: is created without layers, as before",
    async (_label: string, miscDataProps: JSONObject | undefined) => {
      const schedule: OnCallDutyPolicySchedule =
        await createSchedule(miscDataProps);

      expect(schedule.id?.toString()).toBe(SCHEDULE_ID.toString());
      expect(events).toEqual(["schedule create started", "schedule created"]);
      expect(layerCreates).toHaveLength(0);
      expect(layerUserCreates).toHaveLength(0);
      // Nothing extra is looked up either.
      expect(membershipQueries).toHaveLength(0);
    },
  );
});

describe("a schedule with people to take turns", () => {
  test("gets one layer after it is saved, then its people in the order they were picked", async () => {
    const schedule: OnCallDutyPolicySchedule = await createSchedule({
      firstLayerUsers: [SAM, ALEX, PRIYA],
    });

    expect(schedule.id?.toString()).toBe(SCHEDULE_ID.toString());
    expect(events).toEqual([
      "schedule create started",
      "schedule created",
      "layer created",
      `layer user ${SAM}`,
      `layer user ${ALEX}`,
      `layer user ${PRIYA}`,
    ]);
  });

  test("the layer is Layer 1 of the new schedule, on call from now, weekly, around the clock", async () => {
    const before: number = Date.now();

    await createSchedule({ firstLayerUsers: [ALEX] });

    const after: number = Date.now();

    expect(layerCreates).toHaveLength(1);

    const layer: OnCallDutyPolicyScheduleLayer = layerCreates[0]!.data;

    expect(layer).toBeInstanceOf(OnCallDutyPolicyScheduleLayer);
    expect(layer.name).toBe("Layer 1");
    expect(layer.onCallDutyPolicyScheduleId?.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
    expect(layer.projectId?.toString()).toBe(PROJECT_ID.toString());

    // Left to the layer service: it puts the layer first.
    expect(layer.order).toBeUndefined();
    expect(layer.description).toBeUndefined();

    // On call from now.
    expect(layer.startsAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(layer.startsAt!.getTime()).toBeLessThanOrEqual(after);

    // Each person for a week, handing off a week after the start.
    expect(layer.rotation?.intervalType).toBe(EventInterval.Week);
    expect(layer.rotation?.intervalCount.toNumber()).toBe(1);

    const handOffIn: number =
      layer.handOffTime!.getTime() - layer.startsAt!.getTime();

    expect(Math.abs(handOffIn - WEEK_IN_MS)).toBeLessThanOrEqual(3600 * 1000);

    // Around the clock.
    expect(layer.restrictionTimes?.restictionType).toBe(RestrictionType.None);
  });

  test("the first hand-off keeps the time of day in the schedule's time zone", async () => {
    /*
     * Stand the clock where a week spans Berlin's autumn change (25 October
     * 2026): Thursday 22 October, 09:00 CEST is 07:00 UTC; the next Thursday
     * at 09:00 CET is 08:00 UTC.
     */
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-22T07:00:00.000Z"));

    await createSchedule({ firstLayerUsers: [ALEX] });

    const layer: OnCallDutyPolicyScheduleLayer = layerCreates[0]!.data;

    expect(layer.startsAt?.toISOString()).toBe("2026-10-22T07:00:00.000Z");
    expect(layer.handOffTime?.toISOString()).toBe("2026-10-29T08:00:00.000Z");
  });

  test("the layer hands off on the rotation the create asked for", async () => {
    await createSchedule({
      firstLayerUsers: [ALEX, SAM],
      firstLayerRotation: rotationOf(EventInterval.Week, 2).toJSON(),
    });

    const layer: OnCallDutyPolicyScheduleLayer = layerCreates[0]!.data;

    expect(layer.rotation?.intervalType).toBe(EventInterval.Week);
    expect(layer.rotation?.intervalCount.toNumber()).toBe(2);

    const handOffIn: number =
      layer.handOffTime!.getTime() - layer.startsAt!.getTime();

    expect(Math.abs(handOffIn - 2 * WEEK_IN_MS)).toBeLessThanOrEqual(
      3600 * 1000,
    );
  });

  test("each person is a layer user of the new layer, in the schedule and the project", async () => {
    await createSchedule({ firstLayerUsers: [SAM, ALEX] });

    expect(layerUserIds()).toEqual([SAM, ALEX]);

    for (const createBy of layerUserCreates) {
      const layerUser: OnCallDutyPolicyScheduleLayerUser = createBy.data;

      expect(layerUser).toBeInstanceOf(OnCallDutyPolicyScheduleLayerUser);
      expect(layerUser.onCallDutyPolicyScheduleLayerId?.toString()).toBe(
        LAYER_ID.toString(),
      );
      expect(layerUser.onCallDutyPolicyScheduleId?.toString()).toBe(
        SCHEDULE_ID.toString(),
      );
      expect(layerUser.projectId?.toString()).toBe(PROJECT_ID.toString());
      // Left to the service: each goes last, so creation order is turn order.
      expect(layerUser.order).toBeUndefined();
    }
  });

  test("each person once, whatever the case or form they were sent in", async () => {
    await createSchedule({
      firstLayerUsers: [ALEX.toUpperCase(), SAM, new ObjectID(ALEX)],
    } as unknown as JSONObject);

    expect(layerUserIds()).toEqual([ALEX, SAM]);
  });

  test("the layer and its people are created as the caller", async () => {
    const props: DatabaseCommonInteractionProps = callerProps();

    await createSchedule({ firstLayerUsers: [ALEX, SAM] }, props);

    // The very props of the schedule create: same user, same plan, not root.
    expect(layerCreates[0]!.props).toBe(props);
    expect(layerCreates[0]!.props.isRoot).toBeUndefined();

    for (const createBy of layerUserCreates) {
      expect(createBy.props).toBe(props);
    }
  });

  test("an API caller's ObjectIDs and Recurring are read the same as the dashboard's JSON", async () => {
    await createSchedule({
      firstLayerUsers: [new ObjectID(PRIYA), new ObjectID(ALEX).toJSON()],
      firstLayerRotation: rotationOf(EventInterval.Day, 1),
    } as unknown as JSONObject);

    expect(layerUserIds()).toEqual([PRIYA, ALEX]);
    expect(layerCreates[0]!.data.rotation?.intervalType).toBe(
      EventInterval.Day,
    );
  });

  test("a root caller's schedule names its project in the data", async () => {
    const data: OnCallDutyPolicySchedule = newSchedule();
    data.projectId = PROJECT_ID;

    await createSchedule({ firstLayerUsers: [ALEX] }, { isRoot: true }, data);

    expect(layerCreates).toHaveLength(1);
    expect(layerCreates[0]!.props.isRoot).toBe(true);
    expect(String(membershipQueries[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("past the hooks (ignoreHooks), nothing is read and no layer is made", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...callerProps(),
      ignoreHooks: true,
    };

    // Not even a bad list is looked at.
    await createSchedule(
      { firstLayerUsers: "everyone" } as unknown as JSONObject,
      props,
    );

    expect(layerCreates).toHaveLength(0);
    expect(membershipQueries).toHaveLength(0);
    expect(scheduleWasSaved()).toBe(true);
  });
});

describe("refused before anything is saved", () => {
  test("a list that is not a list of user ids", async () => {
    await expect(
      createSchedule({ firstLayerUsers: ["alex@example.com"] }),
    ).rejects.toThrow(BadDataException);

    expect(scheduleWasSaved()).toBe(false);
    expect(layerCreates).toHaveLength(0);
  });

  test("a rotation that is not one", async () => {
    await expect(
      createSchedule({
        firstLayerUsers: [ALEX],
        firstLayerRotation: "weekly",
      }),
    ).rejects.toThrow(
      "firstLayerRotation must be a rotation: how many hours, days, weeks, months or years each turn lasts.",
    );

    expect(scheduleWasSaved()).toBe(false);
  });

  test("a caller who may create schedules but not layers", async () => {
    const attempt: Promise<OnCallDutyPolicySchedule> = createSchedule(
      { firstLayerUsers: [ALEX] },
      callerProps([Permission.CreateProjectOnCallDutyPolicySchedule]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow(
      new OnCallDutyPolicyScheduleLayer().singularName!,
    );

    expect(scheduleWasSaved()).toBe(false);
    expect(membershipQueries).toHaveLength(0);
  });

  test("the same caller with nobody picked still creates the schedule", async () => {
    await createSchedule(
      {},
      callerProps([Permission.CreateProjectOnCallDutyPolicySchedule]),
    );

    expect(scheduleWasSaved()).toBe(true);
    expect(layerCreates).toHaveLength(0);
  });

  test("a caller who may add layers, with the permission adding them by hand needs", async () => {
    await createSchedule(
      { firstLayerUsers: [ALEX] },
      callerProps([
        Permission.CreateProjectOnCallDutyPolicySchedule,
        Permission.CreateOnCallDutyPolicyScheduleLayer,
      ]),
    );

    expect(layerCreates).toHaveLength(1);
    expect(layerUserCreates).toHaveLength(1);
  });

  test("a person who is not a member of the project", async () => {
    await expect(
      createSchedule({ firstLayerUsers: [ALEX, STRANGER] }),
    ).rejects.toThrow(
      "Some of the people picked to take turns are not members of this project.",
    );

    expect(scheduleWasSaved()).toBe(false);
    expect(layerCreates).toHaveLength(0);
  });

  test("a schedule with no project", async () => {
    await expect(
      createSchedule({ firstLayerUsers: [ALEX] }, { isRoot: true }),
    ).rejects.toThrow(
      "A project is required to add people to a new on-call schedule.",
    );

    expect(scheduleWasSaved()).toBe(false);
  });
});

describe("the membership check", () => {
  test("looks the people up in this project only, as root", async () => {
    await createSchedule({ firstLayerUsers: [SAM, ALEX] });

    expect(membershipQueries).toHaveLength(1);
    expect(String(membershipQueries[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(membershipQueries[0]!.props.isRoot).toBe(true);
    expect(idsIn(membershipQueries[0]!.query["userId"])).toEqual([SAM, ALEX]);
  });

  test("is made against the caller's project, not a project named in the data", async () => {
    const data: OnCallDutyPolicySchedule = newSchedule();
    data.projectId = new ObjectID("0c000000-0000-4000-8000-0000000000ff");

    await createSchedule({ firstLayerUsers: [ALEX] }, callerProps(), data);

    expect(String(membershipQueries[0]!.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a person in several of the project's teams is one member", async () => {
    await createSchedule({ firstLayerUsers: [ALEX, CALLER_ID.toString()] });

    expect(layerUserIds()).toEqual([ALEX, CALLER_ID.toString()]);
  });
});

describe("once the schedule is saved", () => {
  test("a layer that cannot be added is logged, and the schedule is kept", async () => {
    layerCreateError = new Error("The database went away.");

    const schedule: OnCallDutyPolicySchedule = await createSchedule({
      firstLayerUsers: [ALEX, SAM],
    });

    expect(schedule.id?.toString()).toBe(SCHEDULE_ID.toString());
    expect(layerCreates).toHaveLength(1);
    // Nobody is added to a layer that does not exist.
    expect(layerUserCreates).toHaveLength(0);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain(
      "The database went away.",
    );
    expect(loggerErrorSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
    });
  });

  test("a person who cannot be added is logged, and the others still take their turns", async () => {
    failingUserIds = [SAM];

    const schedule: OnCallDutyPolicySchedule = await createSchedule({
      firstLayerUsers: [ALEX, SAM, PRIYA],
    });

    expect(schedule.id?.toString()).toBe(SCHEDULE_ID.toString());
    expect(layerUserIds()).toEqual([ALEX, SAM, PRIYA]);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain(
      `${SAM} could not be added.`,
    );
    expect(loggerErrorSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
      onCallDutyPolicyScheduleLayerId: LAYER_ID.toString(),
      userId: SAM,
    });
  });

  test("a schedule create that fails makes no layer", async () => {
    scheduleCreateSpy.mockImplementationOnce(async (): Promise<never> => {
      throw new BadDataException("name is required");
    });

    await expect(createSchedule({ firstLayerUsers: [ALEX] })).rejects.toThrow(
      "name is required",
    );

    expect(layerCreates).toHaveLength(0);
    expect(layerUserCreates).toHaveLength(0);
  });
});

/*
 * What the layer services make of what they are handed: the same layer and
 * layer users Add Layer and Add User would have created.
 */
describe("the layer services, given the first layer", () => {
  test("the layer service puts the layer first and finds nothing wrong with it", async () => {
    await createSchedule({ firstLayerUsers: [ALEX] });

    const createBy: CreateBy<OnCallDutyPolicyScheduleLayer> = layerCreates[0]!;

    // A new schedule has no layers yet.
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findBy")
      .mockResolvedValue([] as never);

    const result: OnCreate<OnCallDutyPolicyScheduleLayer> = await (
      OnCallDutyPolicyScheduleLayerService as unknown as {
        onBeforeCreate: (
          createBy: CreateBy<OnCallDutyPolicyScheduleLayer>,
        ) => Promise<OnCreate<OnCallDutyPolicyScheduleLayer>>;
      }
    ).onBeforeCreate(createBy);

    expect(result.createBy.data.order).toBe(1);
    expect(result.createBy.data.name).toBe("Layer 1");
  });

  test("the layer user service puts each person after the ones before", async () => {
    await createSchedule({ firstLayerUsers: [ALEX, SAM, PRIYA] });

    let usersInLayer: number = 0;

    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "countBy")
      .mockImplementation(async (): Promise<PositiveNumber> => {
        return new PositiveNumber(usersInLayer);
      });
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    const orders: Array<number | undefined> = [];

    for (const createBy of layerUserCreates) {
      const result: OnCreate<OnCallDutyPolicyScheduleLayerUser> = await (
        OnCallDutyPolicyScheduleLayerUserService as unknown as {
          onBeforeCreate: (
            createBy: CreateBy<OnCallDutyPolicyScheduleLayerUser>,
          ) => Promise<OnCreate<OnCallDutyPolicyScheduleLayerUser>>;
        }
      ).onBeforeCreate(createBy);

      orders.push(result.createBy.data.order);
      usersInLayer++;
    }

    expect(orders).toEqual([1, 2, 3]);
  });
});

/*
 * The layer is added once the schedule really exists: after the base create
 * has saved it and run its success hook. This runs the real base create of
 * the schedule (with the database and its side effects stubbed) to pin it.
 */
describe("with the real base create of the schedule", () => {
  test("the layer is made after the schedule is saved and its success hook has run", async () => {
    scheduleCreateSpy.mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      if (this.modelType === OnCallDutyPolicyScheduleLayer) {
        events.push("layer created");
        createBy.data.id = LAYER_ID;
        layerCreates.push(createBy as CreateBy<OnCallDutyPolicyScheduleLayer>);
        return createBy.data;
      }

      if (this.modelType === OnCallDutyPolicyScheduleLayerUser) {
        events.push("layer user created");
        return createBy.data;
      }

      return await REAL_BASE_CREATE.call(this, createBy);
    });

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getRepository")
      .mockReturnValue({
        save: async (
          data: OnCallDutyPolicySchedule,
        ): Promise<OnCallDutyPolicySchedule> => {
          events.push("schedule saved");
          data.id = SCHEDULE_ID;
          return data;
        },
      } as never);

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService as unknown as {
          onCreateSuccess: (
            onCreate: unknown,
            item: OnCallDutyPolicySchedule,
          ) => Promise<OnCallDutyPolicySchedule>;
        },
        "onCreateSuccess",
      )
      .mockImplementation(
        async (
          _onCreate: unknown,
          item: OnCallDutyPolicySchedule,
        ): Promise<OnCallDutyPolicySchedule> => {
          events.push("schedule success hook");
          return item;
        },
      );

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AuditLogService, "recordCreate")
      .mockResolvedValue(undefined as never);

    const schedule: OnCallDutyPolicySchedule = await createSchedule({
      firstLayerUsers: [ALEX],
    });

    expect(schedule.id?.toString()).toBe(SCHEDULE_ID.toString());
    expect(schedule.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(events).toEqual([
      "schedule saved",
      "schedule success hook",
      "layer created",
      "layer user created",
    ]);

    // The layer hands off in the time zone the schedule was saved with.
    expect(layerCreates[0]!.data.onCallDutyPolicyScheduleId?.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
  });
});
