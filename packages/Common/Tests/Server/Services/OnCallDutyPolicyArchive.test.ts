import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * An archived on-call policy pages no one.
 *
 * Everything that pages through a policy - an incident or alert opening, an
 * episode, Slack, Microsoft Teams, the AI assistant - calls executePolicy, so
 * that is where an archived policy is stopped. It does not stop silently: the
 * execution log is still written, as an error that says the policy is
 * archived, so "why was nobody paged?" has an answer on the incident. It is
 * written without the create hooks - those are what start escalating and post
 * "started executing" to the incident's feed.
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

describe("executePolicy and an archived on-call policy", () => {
  test("records a skipped execution instead of paging: an error that says the policy is archived", async () => {
    const { create } = stub(policy(true));

    await executeForIncident();

    expect(create).toHaveBeenCalledTimes(1);

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Error);
    expect(args.data.statusMessage).toBe(
      ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
    );
    expect(args.data.onCallDutyPolicyId?.toString()).toBe(POLICY_ID.toString());
    expect(args.data.triggeredByIncidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(args.data.userNotificationEventType).toBe(
      UserNotificationEventType.IncidentCreated,
    );
  });

  test("writes that log without the hooks that would start escalating", async () => {
    const { create } = stub(policy(true));

    await executeForIncident();

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    expect(args.props.isRoot).toBe(true);
    expect(args.props.ignoreHooks).toBe(true);
    // What onBeforeCreate would have seeded, set by hand since it is skipped.
    expect(args.data.onCallPolicyExecutionRepeatCount).toBe(1);
  });

  test("a live policy is executed as before: scheduled, with its hooks", async () => {
    const { create } = stub(policy(false));

    await executeForIncident();

    const args: CreateArgs = create.mock.calls[0]![0] as unknown as CreateArgs;

    expect(args.data.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(args.data.statusMessage).toBe("Scheduled.");
    expect(args.props.ignoreHooks).toBeUndefined();
  });

  test("a policy read without the flag counts as live (the column's default)", async () => {
    const { create } = stub(policy(undefined));

    await executeForIncident();

    expect(
      (create.mock.calls[0]![0] as unknown as CreateArgs).data.status,
    ).toBe(OnCallDutyPolicyStatus.Scheduled);
  });

  test("reads the archive flag when it looks the policy up", async () => {
    const { findOneById } = stub(policy(false));

    await executeForIncident();

    expect(
      (
        findOneById.mock.calls[0]![0] as unknown as {
          select: Record<string, unknown>;
        }
      ).select["isArchived"],
    ).toBe(true);
  });

  test("the message says nobody was paged and how to bring the policy back", () => {
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toMatch(/archived/);
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toMatch(
      /paged no one/,
    );
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toMatch(/Unarchive/);
  });
});
