import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A POLICY'S FIRST ESCALATION RULE IS ITS LOWEST PLACE (#9369).
 *
 * Rules written through the API or by Terraform keep the place they are
 * given, and a deleted rule leaves its gap (ContiguousOrder moves no other
 * rule), so a policy's only rule can be at 2. A new run looked for the rule at place 1,
 * found none, and ended in "no escalation rules" - every run, while the
 * policy had one. A page again with no place of its own, the test page and
 * When this goes down read the first rule too, and all of them read it by
 * OnCallDutyPolicyEscalationRuleService.findFirstOfPolicy, or for levels in
 * hand getOnCallPolicyFirstLevel, which pick the same one.
 *
 * The real OnCallDutyPolicyExecutionLogService; the escalation rules are a
 * small table the reads are answered from as the database would - by every
 * column the query names, in the order it sorts by.
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallEscalationAdvance from "../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallPageLine";
import { getOnCallPolicyFirstLevel } from "../../../Types/OnCallDutyPolicy/OnCallRunLevel";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";

type AnyFunction = (...args: Array<unknown>) => Promise<unknown>;

const PROJECT: ObjectID = new ObjectID("93690000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("93690000-0000-4000-8000-000000000002");
const OTHER_POLICY: ObjectID = new ObjectID(
  "93690000-0000-4000-8000-000000000009",
);
const RUN: ObjectID = new ObjectID("93690000-0000-4000-8000-000000000003");
const INCIDENT: ObjectID = new ObjectID("93690000-0000-4000-8000-000000000004");

interface RuleRow {
  _id: string;
  projectId: string;
  onCallDutyPolicyId: string;
  order: number;
}

// The escalation rules of the project, as rows.
let rules: Array<RuleRow>;
let paged: Array<string>;
let updates: Array<Record<string, unknown>>;

function ruleAt(order: number, policyId: ObjectID = POLICY): RuleRow {
  return {
    _id: `93690000-0000-4000-8000-0000000001${String(order).padStart(2, "0")}`,
    projectId: PROJECT.toString(),
    onCallDutyPolicyId: policyId.toString(),
    order: order,
  };
}

function idText(value: unknown): string {
  return value === undefined || value === null
    ? ""
    : String(value).toLowerCase();
}

// A read as the database answers it: every column the query names, in the order asked.
function answer(data: {
  query: Record<string, unknown>;
  sort?: Record<string, SortOrder> | undefined;
}): Array<RuleRow> {
  const found: Array<RuleRow> = rules.filter((row: RuleRow): boolean => {
    return Object.entries(data.query).every(
      ([column, value]: [string, unknown]): boolean => {
        return (
          idText((row as unknown as Record<string, unknown>)[column]) ===
          idText(value)
        );
      },
    );
  });

  if (data.sort?.["order"] === SortOrder.Ascending) {
    found.sort((a: RuleRow, b: RuleRow): number => {
      return a.order - b.order;
    });
  }

  return found;
}

function toModel(row: RuleRow): OnCallDutyPolicyEscalationRule {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = new ObjectID(row._id);
  rule.order = row.order;
  return rule;
}

beforeEach(() => {
  rules = [];
  paged = [];
  updates = [];

  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(null as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
      sort?: Record<string, SortOrder>;
    }) => {
      const row: RuleRow | undefined = answer(data)[0];
      return row ? toModel(row) : null;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockImplementation((async (data: { data: Record<string, unknown> }) => {
      updates.push(data.data);
      return 1;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
    .mockImplementation((async (ruleId: ObjectID) => {
      paged.push(ruleId.toString());
      return { movesOnAtOnce: false };
    }) as never);

  jest
    .spyOn(OnCallEscalationAdvance, "moveOnAtOnce")
    .mockResolvedValue(null as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function runOfIncident(): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.projectId = PROJECT;
  run.onCallDutyPolicyId = POLICY;
  run.triggeredByIncidentId = INCIDENT;
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Scheduled;
  return run;
}

// The run's create, as DatabaseService hands it to its hook.
async function created(run: OnCallDutyPolicyExecutionLog): Promise<void> {
  await (
    OnCallDutyPolicyExecutionLogService as unknown as Record<
      string,
      AnyFunction
    >
  )["onCreateSuccess"]!.call(
    OnCallDutyPolicyExecutionLogService,
    {
      createBy: { data: run, props: { isRoot: true } },
      carryForward: { isPolicyArchived: false },
    },
    run,
  );
}

function endedInError(): boolean {
  return updates.some((update: Record<string, unknown>): boolean => {
    return update["status"] === OnCallDutyPolicyStatus.Error;
  });
}

describe("a new run pages its policy's first escalation rule", () => {
  test("a policy whose only rule is at place 2: the run pages it, and does not end in error", async () => {
    rules = [ruleAt(2)];

    await created(runOfIncident());

    expect(paged).toEqual([ruleAt(2)._id]);
    expect(endedInError()).toBe(false);
  });

  test("the first is the lowest place, whatever order the rules were written in", async () => {
    rules = [
      ruleAt(5),
      ruleAt(3),
      ruleAt(4, OTHER_POLICY),
      ruleAt(1, OTHER_POLICY),
    ];

    await created(runOfIncident());

    expect(paged).toEqual([ruleAt(3)._id]);
  });

  test("a policy with rules from 1 pages the rule at place 1, as it always did", async () => {
    rules = [ruleAt(2), ruleAt(1)];

    await created(runOfIncident());

    expect(paged).toEqual([ruleAt(1)._id]);
  });

  test("a policy with no rules still ends saying it has none", async () => {
    rules = [ruleAt(1, OTHER_POLICY)];

    await created(runOfIncident());

    expect(paged).toEqual([]);
    expect(updates).toContainEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
    });
  });
});

describe("one rule for the first escalation rule", () => {
  test("the service's read asks for no place, lowest first", async () => {
    rules = [ruleAt(4), ruleAt(2)];

    const first: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findFirstOfPolicy({
        projectId: PROJECT,
        onCallDutyPolicyId: POLICY,
      });

    expect(first?.order).toBe(2);

    const read: {
      query: Record<string, unknown>;
      sort?: Record<string, unknown>;
    } = (
      OnCallDutyPolicyEscalationRuleService.findOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort?: Record<string, unknown>;
    };

    expect(Object.keys(read.query).sort()).toEqual([
      "onCallDutyPolicyId",
      "projectId",
    ]);
    expect(read.sort).toEqual({ order: SortOrder.Ascending });
  });

  test("and the levels in hand pick the same rule as the read does", async () => {
    const policies: Array<Array<number>> = [
      [2],
      [4, 2, 7],
      [1, 2, 3],
      [3, 1],
      [10, 5, 6],
    ];

    for (const places of policies) {
      rules = places.map((order: number): RuleRow => {
        return ruleAt(order);
      });

      const read: OnCallDutyPolicyEscalationRule | null =
        await OnCallDutyPolicyEscalationRuleService.findFirstOfPolicy({
          projectId: PROJECT,
          onCallDutyPolicyId: POLICY,
        });

      const inHand: OnCallDutyPolicyEscalationRule | null =
        getOnCallPolicyFirstLevel(rules.map(toModel));

      expect(inHand?.id?.toString()).toBe(read?.id?.toString());
      expect(inHand?.order).toBe(Math.min(...places));
    }
  });
});
