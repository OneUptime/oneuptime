import { RumSessionErasureRequestType } from "../../../Models/DatabaseModels/RumSessionErasureRequest";
import IncomingCallPolicyEscalationRuleService from "../../../Server/Services/IncomingCallPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import ProjectService from "../../../Server/Services/ProjectService";
import RumSessionErasureRequestService from "../../../Server/Services/RumSessionErasureRequestService";
import RumSessionPinService from "../../../Server/Services/RumSessionPinService";
import UserOnCallShiftReminderService from "../../../Server/Services/UserOnCallShiftReminderService";
import UserService from "../../../Server/Services/UserService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A reference a hook decides itself - the person a record is by, the policy
 * a rule is added to, who an incoming call rings - is written under its ID
 * column alone (RelationIdUtil.stamp). The relation and its ID column are one
 * database column and TypeORM stores the relation's id when a write carries
 * both, so a relation the request sent beside the decided value would be
 * stored in its place. And a reference a hook reads to decide something is
 * read under both of its names. HookReferenceWritesUseStamp holds every
 * service to the first half; these run the hooks it changed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a3d-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5a3d-4aaa-8bbb-0000000000e1");
const ID_A: string = "0193c0de-5a3d-4aaa-8bbb-0000000000a1";
const ID_B: string = "0193c0de-5a3d-4aaa-8bbb-0000000000b2";
const RECORD_ID: string = "0193c0de-5a3d-4aaa-8bbb-0000000000c3";

class PastTheStep extends Error {}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Hook = (write: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  const hook: Hook = (service as Record<string, Hook>)[name]!;

  return hook.bind(service);
}

// What a hook did: went on, or the error it stopped with.
async function outcomeOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
    return "went on";
  } catch (error) {
    return error;
  }
}

function has(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

describe("an authenticator is enrolled for the person making the request", () => {
  test.each([
    ["a TOTP authenticator", UserTotpAuthService],
    ["a passkey", UserWebAuthnService],
  ])(
    "%s: a user relation sent beside the session user is not what is stored",
    async (_label: string, service: unknown) => {
      jest
        .spyOn(UserService, "findOneById")
        .mockRejectedValue(new PastTheStep() as never);

      const data: Record<string, unknown> = {
        name: "My phone",
        user: { _id: ID_B },
      };

      const outcome: unknown = await outcomeOf(
        hookOf(
          service,
          "onBeforeCreate",
        )({
          data: data,
          props: { userId: USER_ID },
        }),
      );

      expect(outcome).toBeInstanceOf(PastTheStep);
      expect(String(data["userId"])).toBe(USER_ID.toString());
      expect(has(data, "user")).toBe(false);
    },
  );
});

describe("a session replay erasure is asked for by the person making the request", () => {
  function erasure(): Record<string, unknown> {
    return {
      projectId: PROJECT_ID,
      requestType: RumSessionErasureRequestType.BySessionId,
      targetValue: "session-1",
      requestedByUser: { _id: ID_B },
    };
  }

  test("a requestedByUser relation sent beside the session user is not what is stored", async () => {
    const data: Record<string, unknown> = erasure();

    await hookOf(
      RumSessionErasureRequestService,
      "onBeforeCreate",
    )({ data: data, props: { tenantId: PROJECT_ID, userId: USER_ID } });

    expect(String(data["requestedByUserId"])).toBe(USER_ID.toString());
    expect(has(data, "requestedByUser")).toBe(false);
  });

  test("with no person on the request, neither name is kept", async () => {
    const data: Record<string, unknown> = {
      ...erasure(),
      requestedByUserId: new ObjectID(ID_A),
    };

    await hookOf(
      RumSessionErasureRequestService,
      "onBeforeCreate",
    )({ data: data, props: { tenantId: PROJECT_ID } });

    expect(has(data, "requestedByUserId")).toBe(false);
    expect(has(data, "requestedByUser")).toBe(false);
  });
});

describe("a recording is pinned by the person making the request", () => {
  function pin(): Record<string, unknown> {
    return {
      projectId: PROJECT_ID,
      rumApplicationId: new ObjectID(ID_A),
      sessionId: "session-1",
      pinnedByUser: { _id: ID_B },
    };
  }

  test("a pinnedByUser relation sent beside the session user is not what is stored", async () => {
    const data: Record<string, unknown> = pin();

    await hookOf(
      RumSessionPinService,
      "onBeforeCreate",
    )({ data: data, props: { tenantId: PROJECT_ID, userId: USER_ID } });

    expect(String(data["pinnedByUserId"])).toBe(USER_ID.toString());
    expect(has(data, "pinnedByUser")).toBe(false);
  });

  test("with no person on the request, neither name is kept", async () => {
    const data: Record<string, unknown> = pin();

    await hookOf(
      RumSessionPinService,
      "onBeforeCreate",
    )({ data: data, props: { tenantId: PROJECT_ID } });

    expect(has(data, "pinnedByUserId")).toBe(false);
    expect(has(data, "pinnedByUser")).toBe(false);
  });
});

describe("a project is created by the person making the request", () => {
  test("a createdByUser relation sent beside the session user is not what is stored", async () => {
    jest
      .spyOn(ProjectService, "assertAuditLogSettingsChangeIsLicensed")
      .mockRejectedValue(new PastTheStep() as never);

    const data: Record<string, unknown> = {
      name: "Payments",
      createdByUser: { _id: ID_B },
    };

    const outcome: unknown = await outcomeOf(
      hookOf(
        ProjectService,
        "onBeforeCreate",
      )({ data: data, props: { userId: USER_ID } }),
    );

    expect(outcome).toBeInstanceOf(PastTheStep);
    expect(String(data["createdByUserId"])).toBe(USER_ID.toString());
    expect(has(data, "createdByUser")).toBe(false);
  });
});

describe("a shift reminder belongs to the owner it names, under either name", () => {
  let duplicateQueries: Array<Record<string, unknown>>;

  beforeEach(() => {
    duplicateQueries = [];

    jest
      .spyOn(UserOnCallShiftReminderService, "countBy")
      .mockImplementation((async (request: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        duplicateQueries.push(request.query);
        return new PositiveNumber(0);
      }) as never);
  });

  async function create(data: Record<string, unknown>): Promise<unknown> {
    return await outcomeOf(
      hookOf(
        UserOnCallShiftReminderService,
        "onBeforeCreate",
      )({
        data: { projectId: PROJECT_ID, minutesBeforeShift: 60, ...data },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );
  }

  test("an owner sent as the relation is the one the duplicate check and the row use", async () => {
    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      minutesBeforeShift: 60,
      user: { _id: ID_A },
    };

    await hookOf(
      UserOnCallShiftReminderService,
      "onBeforeCreate",
    )({ data: data, props: { tenantId: PROJECT_ID, userId: USER_ID } });

    expect(String(duplicateQueries[0]!["userId"])).toBe(ID_A);
    expect(String(data["userId"])).toBe(ID_A);
    expect(has(data, "user")).toBe(false);
  });

  test("with no owner sent, the reminder is the session user's", async () => {
    expect(await create({})).toBe("went on");
    expect(String(duplicateQueries[0]!["userId"])).toBe(USER_ID.toString());
  });

  test("an owner named twice, differently, is refused, naming both fields", async () => {
    const outcome: unknown = await create({
      userId: new ObjectID(ID_A),
      user: { _id: ID_B },
    });

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as Error).message).toBe(
      RelationIdUtil.getConflictMessage("User", ["userId", "user"]),
    );
    expect(duplicateQueries).toEqual([]);
  });
});

describe("an incoming call rule rings a user or a schedule, under either name of each", () => {
  const PROPS: Record<string, unknown> = {
    tenantId: PROJECT_ID,
    userId: USER_ID,
  };

  async function create(data: Record<string, unknown>): Promise<unknown> {
    return await outcomeOf(
      hookOf(
        IncomingCallPolicyEscalationRuleService,
        "onBeforeCreate",
      )({
        data: {
          projectId: PROJECT_ID,
          incomingCallPolicyId: new ObjectID(RECORD_ID),
          ...data,
        },
        props: PROPS,
      }),
    );
  }

  test.each([
    [
      "both as relations",
      { user: { _id: ID_A }, onCallDutyPolicySchedule: { _id: ID_B } },
    ],
    [
      "a user as the relation and a schedule as the ID",
      {
        user: { _id: ID_A },
        onCallDutyPolicyScheduleId: new ObjectID(ID_B),
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "a rule naming a user and a schedule is refused: %s",
    async (_label: string, data: Record<string, unknown>) => {
      expect(((await create(data)) as Error).message).toBe(
        "Only one of User or On-Call Schedule can be specified, not both",
      );
    },
  );

  test("a rule naming its user as the relation goes on", async () => {
    expect(await create({ user: { _id: ID_A } })).toBe("went on");
  });

  test("a rule whose policy is sent as the relation goes on", async () => {
    expect(
      await outcomeOf(
        hookOf(
          IncomingCallPolicyEscalationRuleService,
          "onBeforeCreate",
        )({
          data: {
            projectId: PROJECT_ID,
            incomingCallPolicy: { _id: RECORD_ID },
            userId: new ObjectID(ID_A),
          },
          props: PROPS,
        }),
      ),
    ).toBe("went on");
  });

  test("an update that sets the user as the relation clears the schedule under both names", async () => {
    getJestSpyOn(
      IncomingCallPolicyEscalationRuleService,
      "findOneBy",
    ).mockResolvedValue({
      userId: null,
      onCallDutyPolicyScheduleId: new ObjectID(ID_B),
    });

    const data: Record<string, unknown> = {
      user: { _id: ID_A },
      onCallDutyPolicySchedule: undefined,
    };

    await hookOf(
      IncomingCallPolicyEscalationRuleService,
      "onBeforeUpdate",
    )({
      query: { _id: RECORD_ID },
      data: data,
      props: PROPS,
    });

    expect(data["onCallDutyPolicyScheduleId"]).toBeNull();
    expect(has(data, "onCallDutyPolicySchedule")).toBe(false);
  });
});

describe("an escalation rule is added to the policy it names, under either name", () => {
  test("a policy sent as the relation is the one counted, ordered on and stored", async () => {
    const counted: Array<Record<string, unknown>> = [];

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockImplementation((async (request: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        counted.push(request.query);
        return new PositiveNumber(1);
      }) as never);

    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      escalateAfterInMinutes: 30,
      onCallDutyPolicy: { _id: ID_A },
    };

    await hookOf(
      OnCallDutyPolicyEscalationRuleService,
      "onBeforeCreate",
    )({ data: data, props: { isRoot: true } });

    expect(counted.length).toBeGreaterThan(0);

    for (const query of counted) {
      expect(String(query["onCallDutyPolicyId"])).toBe(ID_A);
    }

    expect(String(data["onCallDutyPolicyId"])).toBe(ID_A);
    expect(has(data, "onCallDutyPolicy")).toBe(false);
    expect(data["order"]).toBe(2);
  });

  test("a policy named twice, differently, is refused before anything is counted", async () => {
    const count: jest.SpyInstance = getJestSpyOn(
      OnCallDutyPolicyEscalationRuleService,
      "countBy",
    );

    const outcome: unknown = await outcomeOf(
      hookOf(
        OnCallDutyPolicyEscalationRuleService,
        "onBeforeCreate",
      )({
        data: {
          projectId: PROJECT_ID,
          onCallDutyPolicyId: new ObjectID(ID_A),
          onCallDutyPolicy: { _id: ID_B },
        },
        props: { isRoot: true },
      }),
    );

    expect((outcome as Error).message).toBe(
      RelationIdUtil.getConflictMessage("On-Call Policy", [
        "onCallDutyPolicyId",
        "onCallDutyPolicy",
      ]),
    );
    expect(count).not.toHaveBeenCalled();
  });
});
