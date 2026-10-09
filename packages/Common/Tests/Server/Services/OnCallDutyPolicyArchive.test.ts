import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * An archived on-call policy pages no one.
 *
 * Every execution of a policy is the creation of its execution log - by
 * executePolicy, when an incident, alert or episode opens or the AI
 * assistant asks, or by a record's Execute On-Call Policy in the dashboard,
 * the API, Slack or Microsoft Teams - so the log service's create is where
 * an archived policy is stopped. It does not stop silently: the log is still
 * written, as an error that says the policy is archived, so "why was nobody
 * paged?" has an answer on the incident; and nothing follows it - no
 * escalation, no "started executing" in the incident's feed.
 */

const POLICY_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000003",
);

interface CreateArgs {
  data: OnCallDutyPolicyExecutionLog;
  props: { isRoot?: boolean; ignoreHooks?: boolean };
}

function policy(isArchived: boolean | undefined): OnCallDutyPolicy {
  const row: OnCallDutyPolicy = new OnCallDutyPolicy();
  row.id = POLICY_ID;
  row.projectId = PROJECT_ID;

  if (isArchived !== undefined) {
    row.isArchived = isArchived;
  }

  return row;
}

function stub(row: OnCallDutyPolicy | null): {
  findOneById: SpyInstance<typeof OnCallDutyPolicyService.findOneById>;
  create: SpyInstance<typeof OnCallDutyPolicyExecutionLogService.create>;
} {
  return {
    findOneById: jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(row),
    create: jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation(async (args: unknown) => {
        return (args as CreateArgs).data;
      }),
  };
}

async function executeForIncident(): Promise<void> {
  await OnCallDutyPolicyService.executePolicy(POLICY_ID, {
    triggeredByIncidentId: INCIDENT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

// The log service's own create hooks, which hold the archived rule.
type BeforeCreateResult = {
  createBy: { data: OnCallDutyPolicyExecutionLog };
  carryForward: unknown;
};

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<BeforeCreateResult>;
  onCreateSuccess: (
    onCreate: unknown,
    createdItem: OnCallDutyPolicyExecutionLog,
  ) => Promise<OnCallDutyPolicyExecutionLog>;
};

const hooks: Hooks = OnCallDutyPolicyExecutionLogService as unknown as Hooks;

describe("executePolicy and an archived on-call policy", () => {
  beforeEach(() => {
    // The records the log names belong to the project (checked elsewhere).
    jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
  });

  test("writes the execution log through the log service's create, hooks and all", async () => {
    const { create } = stub(policy(true));

    await executeForIncident();

    expect(create).toHaveBeenCalledTimes(1);

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    // The hooks hold the archived rule, so they run.
    expect(args.props.isRoot).toBe(true);
    expect(args.props.ignoreHooks).toBeUndefined();
    expect(args.data.onCallDutyPolicyId?.toString()).toBe(POLICY_ID.toString());
    expect(args.data.triggeredByIncidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(args.data.userNotificationEventType).toBe(
      UserNotificationEventType.IncidentCreated,
    );
  });

  test("an archived policy's log is recorded as not executed, with the reason, and starts nothing", async () => {
    const { create } = stub(policy(true));

    await executeForIncident();

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    // What the log service's create makes of what executePolicy asked for.
    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: args.data,
      props: args.props,
    });

    expect(onCreate.createBy.data.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(onCreate.createBy.data.statusMessage).toBe(
      ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
    );
    expect(onCreate.createBy.data.onCallPolicyExecutionRepeatCount).toBe(1);
    expect(onCreate.carryForward).toEqual({ isPolicyArchived: true });
  });

  test("a live policy is executed as before: scheduled, with its hooks", async () => {
    const { create } = stub(policy(false));

    await executeForIncident();

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(args.data.statusMessage).toBe("Scheduled.");
    expect(args.props.ignoreHooks).toBeUndefined();

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: args.data,
      props: args.props,
    });

    expect(onCreate.createBy.data.status).toBe(
      OnCallDutyPolicyStatus.Scheduled,
    );
    expect(onCreate.carryForward).toEqual({ isPolicyArchived: false });
  });

  test("a policy read without the flag counts as live (the column's default)", async () => {
    const { create } = stub(policy(undefined));

    await executeForIncident();

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: args.data,
      props: args.props,
    });

    expect(onCreate.createBy.data.status).toBe(
      OnCallDutyPolicyStatus.Scheduled,
    );
  });

  test("an unknown policy is refused, and no log is written", async () => {
    const { create } = stub(null);

    await expect(executeForIncident()).rejects.toThrow(
      `On-Call Duty Policy with id ${POLICY_ID.toString()} not found`,
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("the message says nobody was paged and how to bring the policy back", () => {
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toMatch(/archived/);
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toMatch(
      /paged no one/,
    );
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toMatch(/Unarchive/);
  });
});

/*
 * The same rule on every other way an execution is asked for: the log a
 * record's Execute On-Call Policy creates - from the dashboard, the API,
 * Slack or Microsoft Teams, made with the asker's own props - goes through
 * the log service's create hooks. For an archived policy they write the log
 * as the same error, and start nothing after it.
 */
describe("an execution log created for an archived on-call policy", () => {
  function requested(): OnCallDutyPolicyExecutionLog {
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    log.projectId = PROJECT_ID;
    log.onCallDutyPolicyId = POLICY_ID;
    log.triggeredByIncidentId = INCIDENT_ID;
    log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    return log;
  }

  // A member's request, as the dashboard and the chat actions make it.
  const memberProps: { userId: ObjectID; tenantId: ObjectID } = {
    userId: new ObjectID("0c000000-0000-4000-8000-000000000004"),
    tenantId: PROJECT_ID,
  };

  beforeEach(() => {
    // The records the log names belong to the project (checked elsewhere).
    jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
  });

  test("is written as an error that says the policy is archived", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(policy(true));

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: requested(),
      props: memberProps,
    });

    expect(onCreate.createBy.data.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(onCreate.createBy.data.statusMessage).toBe(
      ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
    );
    expect(onCreate.carryForward).toEqual({ isPolicyArchived: true });
  });

  test("reads the policy's archive flag as OneUptime, under either name of the policy", async () => {
    const findOneById: SpyInstance<typeof OnCallDutyPolicyService.findOneById> =
      jest
        .spyOn(OnCallDutyPolicyService, "findOneById")
        .mockResolvedValue(policy(true));

    const named: OnCallDutyPolicyExecutionLog = requested();
    delete named.onCallDutyPolicyId;
    named.onCallDutyPolicy = policy(undefined);

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: named,
      props: memberProps,
    });

    expect(onCreate.createBy.data.status).toBe(OnCallDutyPolicyStatus.Error);
    const lookup: { id: ObjectID; props: { isRoot?: boolean } } = findOneById
      .mock.calls[0]![0] as unknown as {
      id: ObjectID;
      props: { isRoot?: boolean };
    };
    expect(lookup.id.toString()).toBe(POLICY_ID.toString());
    expect(lookup.props.isRoot).toBe(true);
  });

  test("a live policy's log is scheduled, as before", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(policy(false));

    const onCreate: BeforeCreateResult = await hooks.onBeforeCreate({
      data: requested(),
      props: memberProps,
    });

    expect(onCreate.createBy.data.status).toBe(
      OnCallDutyPolicyStatus.Scheduled,
    );
    expect(onCreate.createBy.data.statusMessage).toBe("Scheduled.");
    expect(onCreate.carryForward).toEqual({ isPolicyArchived: false });
  });

  test("starts no escalation and posts nothing after an archived policy's log is saved", async () => {
    const policyRead: SpyInstance<typeof OnCallDutyPolicyService.findOneById> =
      jest.spyOn(OnCallDutyPolicyService, "findOneById");
    const update: SpyInstance<
      typeof OnCallDutyPolicyExecutionLogService.updateOneById
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const saved: OnCallDutyPolicyExecutionLog = requested();
    saved.id = ObjectID.generate();

    const result: OnCallDutyPolicyExecutionLog = await hooks.onCreateSuccess(
      {
        createBy: { data: saved, props: memberProps },
        carryForward: { isPolicyArchived: true },
      },
      saved,
    );

    expect(result).toBe(saved);
    expect(policyRead).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
