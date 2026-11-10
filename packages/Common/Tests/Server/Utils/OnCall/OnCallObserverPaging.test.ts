import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallObserverPaging from "../../../../Server/Utils/OnCall/OnCallObserverPaging";
import { OnCallRulePagingHold } from "../../../../Server/Utils/OnCall/OnCallRulePagingHold";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE POLICIES A RECORD'S RULES PAGE AS OBSERVERS ARE PAGED BESIDE IT
 * (OnCallObserverPaging): each by a run of its own that pages as observers,
 * held as its rule says. When the record changed, a policy that has paged
 * about it before - as responders or observers - is not paged again: the
 * people a run reached about the record know about it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const POLICY_A: string = "7d000000-0000-4000-8000-00000000000a";
const POLICY_B: string = "7d000000-0000-4000-8000-00000000000b";

let executePolicy: jest.SpiedFunction<
  typeof OnCallDutyPolicyService.executePolicy
>;

beforeEach(() => {
  executePolicy = jest
    .spyOn(OnCallDutyPolicyService, "executePolicy")
    .mockResolvedValue(undefined as never) as unknown as typeof executePolicy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pagedPolicyIds(): Array<string> {
  return executePolicy.mock.calls
    .map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .sort();
}

describe("paging a record's observer policies", () => {
  test("each policy runs once, paging as observers, about the record", async () => {
    const paged: Array<string> = await OnCallObserverPaging.pagePolicies({
      projectId: PROJECT_ID,
      policyIds: [POLICY_A, POLICY_B, POLICY_A, ""],
      holds: new Map<string, OnCallRulePagingHold>(),
      record: {
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      },
    });

    expect(paged.sort()).toEqual([POLICY_A, POLICY_B].sort());
    expect(pagedPolicyIds()).toEqual([POLICY_A, POLICY_B].sort());

    for (const call of executePolicy.mock.calls) {
      expect(call[1]).toEqual({
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        isObserverPage: true,
      });
    }
  });

  test("a held policy waits as its rule says", async () => {
    const pagingStartsAt: Date = new Date(Date.now() + 60 * 60 * 1000);

    await OnCallObserverPaging.pagePolicies({
      projectId: PROJECT_ID,
      policyIds: [POLICY_A],
      holds: new Map<string, OnCallRulePagingHold>([
        [
          POLICY_A,
          {
            pagingStartsAt: pagingStartsAt,
            waitingStatusMessage: "Waiting for working hours.",
          },
        ],
      ]),
      record: {
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      },
    });

    expect(executePolicy.mock.calls[0]![1]).toMatchObject({
      isObserverPage: true,
      pagingStartsAt: pagingStartsAt,
      waitingStatusMessage: "Waiting for working hours.",
    });
  });

  test("one policy that cannot be paged does not stop the others", async () => {
    executePolicy.mockImplementation(async (policyId: ObjectID) => {
      if (policyId.toString() === POLICY_A) {
        throw new Error("archived");
      }
    });

    const paged: Array<string> = await OnCallObserverPaging.pagePolicies({
      projectId: PROJECT_ID,
      policyIds: [POLICY_A, POLICY_B],
      holds: new Map<string, OnCallRulePagingHold>(),
      record: {
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      },
    });

    expect(paged).toEqual([POLICY_B]);
  });

  test("nothing to page about, or nobody to page: nothing paged", async () => {
    expect(
      await OnCallObserverPaging.pagePolicies({
        projectId: PROJECT_ID,
        policyIds: [POLICY_A],
        holds: new Map<string, OnCallRulePagingHold>(),
        record: {
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        },
      }),
    ).toEqual([]);

    expect(
      await OnCallObserverPaging.pagePolicies({
        projectId: PROJECT_ID,
        policyIds: [],
        holds: new Map<string, OnCallRulePagingHold>(),
        record: {
          triggeredByIncidentId: INCIDENT_ID,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        },
      }),
    ).toEqual([]);

    expect(executePolicy).not.toHaveBeenCalled();
  });

  test("when asked, a policy that paged about the record before is not paged again", async () => {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.onCallDutyPolicyId = new ObjectID(POLICY_A.toUpperCase());

    const findBy: jest.SpiedFunction<
      typeof OnCallDutyPolicyExecutionLogService.findBy
    > = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockResolvedValue([run] as never) as unknown as jest.SpiedFunction<
      typeof OnCallDutyPolicyExecutionLogService.findBy
    >;

    const paged: Array<string> = await OnCallObserverPaging.pagePolicies({
      projectId: PROJECT_ID,
      policyIds: [POLICY_A, POLICY_B],
      holds: new Map<string, OnCallRulePagingHold>(),
      record: {
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      },
      skipPoliciesPagedBefore: true,
    });

    expect(paged).toEqual([POLICY_B]);
    expect(pagedPolicyIds()).toEqual([POLICY_B]);

    // The runs of the record and those policies, any kind.
    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as unknown as { query: Record<string, unknown> }
    ).query;
    expect(query["triggeredByIncidentId"]).toEqual(INCIDENT_ID);
    expect(query["onCallDutyPolicyId"]).toBeDefined();
    expect(query["isObserverPage"]).toBeUndefined();
  });
});
