import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallPolicyEscalationRuleService from "../../../Server/Services/IncomingCallPolicyEscalationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An escalation rule escalates to exactly one target: a user, or an on-call
 * schedule. A rule with neither escalates to nobody and a rule with both is
 * ambiguous, so both are refused at write time rather than discovered when a
 * call comes in. onBeforeCreate is protected; reach it through the singleton
 * the way the DatabaseService pipeline does.
 */
type HookAccess = {
  onBeforeCreate: (
    createBy: CreateBy<IncomingCallPolicyEscalationRule>,
  ) => Promise<{ createBy: CreateBy<IncomingCallPolicyEscalationRule> }>;
};

const service: HookAccess =
  IncomingCallPolicyEscalationRuleService as unknown as HookAccess;

const POLICY_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function makeCreateBy(
  data: Partial<IncomingCallPolicyEscalationRule>,
): CreateBy<IncomingCallPolicyEscalationRule> {
  const rule: IncomingCallPolicyEscalationRule =
    new IncomingCallPolicyEscalationRule();
  Object.assign(rule, data);

  return {
    data: rule,
    props: { isRoot: true },
  } as CreateBy<IncomingCallPolicyEscalationRule>;
}

let countBy: jest.SpiedFunction<
  typeof IncomingCallPolicyEscalationRuleService.countBy
>;

beforeEach(() => {
  // Ordering is exercised separately; stub the two calls that reach the DB.
  countBy = jest
    .spyOn(IncomingCallPolicyEscalationRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  jest
    .spyOn(IncomingCallPolicyEscalationRuleService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncomingCallPolicyEscalationRuleService.onBeforeCreate — target", () => {
  test("accepts a rule that escalates to a user", async () => {
    const result: { createBy: CreateBy<IncomingCallPolicyEscalationRule> } =
      await service.onBeforeCreate(
        makeCreateBy({
          incomingCallPolicyId: POLICY_ID,
          userId: USER_ID,
        }),
      );

    expect(result.createBy.data.userId).toBe(USER_ID);
  });

  test("accepts a rule that escalates to an on-call schedule", async () => {
    const result: { createBy: CreateBy<IncomingCallPolicyEscalationRule> } =
      await service.onBeforeCreate(
        makeCreateBy({
          incomingCallPolicyId: POLICY_ID,
          onCallDutyPolicyScheduleId: SCHEDULE_ID,
        }),
      );

    expect(result.createBy.data.onCallDutyPolicyScheduleId).toBe(SCHEDULE_ID);
  });

  // A rule with no target would silently escalate to nobody.
  test("rejects a rule with no target at all", async () => {
    await expect(
      service.onBeforeCreate(makeCreateBy({ incomingCallPolicyId: POLICY_ID })),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeCreate(makeCreateBy({ incomingCallPolicyId: POLICY_ID })),
    ).rejects.toThrow(/Either a User or an On-Call Schedule/);
  });

  // A rule with two targets is ambiguous about who the call reaches.
  test("rejects a rule that names both a user and a schedule", async () => {
    await expect(
      service.onBeforeCreate(
        makeCreateBy({
          incomingCallPolicyId: POLICY_ID,
          userId: USER_ID,
          onCallDutyPolicyScheduleId: SCHEDULE_ID,
        }),
      ),
    ).rejects.toThrow(/Only one of User or On-Call Schedule/);
  });

  test("rejects a rule that belongs to no policy", async () => {
    await expect(
      service.onBeforeCreate(makeCreateBy({ userId: USER_ID })),
    ).rejects.toThrow(/incomingCallPolicyId is required/);
  });

  /*
   * The target check runs before the policy check, so a payload that is wrong
   * in both ways reports the target problem — the one the user can act on.
   */
  test("refuses an untargeted rule before it looks at the policy", async () => {
    await expect(service.onBeforeCreate(makeCreateBy({}))).rejects.toThrow(
      /Either a User or an On-Call Schedule/,
    );
  });

  test("does not touch the database when validation fails", async () => {
    await expect(
      service.onBeforeCreate(makeCreateBy({ incomingCallPolicyId: POLICY_ID })),
    ).rejects.toThrow(BadDataException);

    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("IncomingCallPolicyEscalationRuleService.onBeforeCreate — order", () => {
  /*
   * A rule created without an explicit order goes to the end of the policy's
   * escalation chain, which is one past the rules already there.
   */
  test("appends a rule with no order to the end of the chain", async () => {
    countBy.mockResolvedValue(new PositiveNumber(3) as never);

    const result: { createBy: CreateBy<IncomingCallPolicyEscalationRule> } =
      await service.onBeforeCreate(
        makeCreateBy({
          incomingCallPolicyId: POLICY_ID,
          userId: USER_ID,
        }),
      );

    expect(result.createBy.data.order).toBe(4);
  });

  test("gives the first rule of a policy order 1", async () => {
    countBy.mockResolvedValue(new PositiveNumber(0) as never);

    const result: { createBy: CreateBy<IncomingCallPolicyEscalationRule> } =
      await service.onBeforeCreate(
        makeCreateBy({
          incomingCallPolicyId: POLICY_ID,
          userId: USER_ID,
        }),
      );

    expect(result.createBy.data.order).toBe(1);
  });

  // Counting must be scoped to the policy, or orders collide across policies.
  test("counts only the rules of the policy being appended to", async () => {
    await service.onBeforeCreate(
      makeCreateBy({
        incomingCallPolicyId: POLICY_ID,
        userId: USER_ID,
      }),
    );

    const query: { incomingCallPolicyId?: ObjectID } = (
      countBy.mock.calls[0]![0] as unknown as {
        query: { incomingCallPolicyId?: ObjectID };
      }
    ).query;

    expect(query.incomingCallPolicyId).toBe(POLICY_ID);
  });

  test("keeps an explicitly requested order", async () => {
    const result: { createBy: CreateBy<IncomingCallPolicyEscalationRule> } =
      await service.onBeforeCreate(
        makeCreateBy({
          incomingCallPolicyId: POLICY_ID,
          userId: USER_ID,
          order: 2,
        }),
      );

    expect(result.createBy.data.order).toBe(2);
    expect(countBy).not.toHaveBeenCalled();
  });
});
