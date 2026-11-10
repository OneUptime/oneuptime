import Incident from "../../../../Models/DatabaseModels/Incident";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import IncidentOnCallRuleEngineService from "../../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import IncidentRulesOnChange from "../../../../Server/Utils/Incident/IncidentRulesOnChange";
import OnCallObserverPaging from "../../../../Server/Utils/OnCall/OnCallObserverPaging";
import { OnCallRulesPaging } from "../../../../Server/Utils/OnCall/OnCallRulePageAs";
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
 * AN INCIDENT'S RULES RUN AGAIN WHEN ITS SEVERITY OR LABELS CHANGE
 * (IncidentRulesOnChange).
 *
 * "Sev 0-1: paged automatically, but they are only observers... Org-wide or
 * meets other criteria: escalate/assign to the oversight team X."
 * Incidents are raised to Sev 1, and labelled org-wide, while they go on:
 * the owner and on-call rules then do what they say, as if the incident had
 * been declared that way - owners added, policies paged as responders or
 * observers - and say why in its feed. Nothing is undone; a resolved
 * incident runs nothing; one change at a time, under a lock.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000002",
);
const RESPONDERS: string = "7e000000-0000-4000-8000-00000000000a";
const OBSERVERS: string = "7e000000-0000-4000-8000-00000000000b";

let ownerRules: jest.SpiedFunction<
  typeof IncidentOwnerRuleEngineService.applyRulesToIncident
>;
let onCallRules: jest.SpiedFunction<
  typeof IncidentOnCallRuleEngineService.applyRulesToIncident
>;
let executePolicy: jest.SpiedFunction<
  typeof OnCallDutyPolicyService.executePolicy
>;
let pageObservers: jest.SpiedFunction<typeof OnCallObserverPaging.pagePolicies>;
let lock: jest.SpiedFunction<typeof Semaphore.lock>;
let release: jest.SpiedFunction<typeof Semaphore.release>;
let isResolved: boolean;
let paging: OnCallRulesPaging;

function incident(): Incident {
  const item: Incident = new Incident();
  item.id = INCIDENT_ID;
  item.projectId = PROJECT_ID;
  return item;
}

beforeEach(() => {
  isResolved = false;
  paging = {
    addedPolicyIds: [],
    observerPolicyIds: [],
    holds: new Map<string, OnCallRulePagingHold>(),
  };

  lock = jest.spyOn(Semaphore, "lock").mockResolvedValue({
    release: async () => {},
  } as never) as unknown as typeof lock;
  release = jest
    .spyOn(Semaphore, "release")
    .mockResolvedValue(undefined) as unknown as typeof release;

  jest
    .spyOn(IncidentService, "isIncidentResolved")
    .mockImplementation(async () => {
      return isResolved;
    });
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());

  ownerRules = jest
    .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined) as unknown as typeof ownerRules;
  onCallRules = jest
    .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
    .mockImplementation(async () => {
      return paging;
    }) as unknown as typeof onCallRules;
  executePolicy = jest
    .spyOn(OnCallDutyPolicyService, "executePolicy")
    .mockResolvedValue(undefined) as unknown as typeof executePolicy;
  pageObservers = jest
    .spyOn(OnCallObserverPaging, "pagePolicies")
    .mockResolvedValue([]) as unknown as typeof pageObservers;
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function change(data: {
  isSeverityChanged?: boolean;
  isLabelsChanged?: boolean;
}): Promise<void> {
  await IncidentRulesOnChange.onIncidentChanged({
    incidentId: INCIDENT_ID,
    projectId: PROJECT_ID,
    change: {
      isSeverityChanged: Boolean(data.isSeverityChanged),
      isLabelsChanged: Boolean(data.isLabelsChanged),
    },
  });
}

describe("which changes run the rules again", () => {
  test.each([
    [{ isSeverityChanged: true }, true, "its severity changed"],
    [{ isLabelsChanged: true }, true, "its labels changed"],
    [
      { isSeverityChanged: true, isLabelsChanged: true },
      true,
      "its severity and labels changed",
    ],
    [{}, false, ""],
  ])(
    "%p: runs again %p, saying %p",
    (
      given: { isSeverityChanged?: boolean; isLabelsChanged?: boolean },
      runs: boolean,
      said: string,
    ) => {
      const changed: {
        isSeverityChanged: boolean;
        isLabelsChanged: boolean;
      } = {
        isSeverityChanged: Boolean(given.isSeverityChanged),
        isLabelsChanged: Boolean(given.isLabelsChanged),
      };

      expect(IncidentRulesOnChange.isRuleRerunChange(changed)).toBe(runs);
      expect(IncidentRulesOnChange.describeChange(changed)).toBe(said);
    },
  );

  test("nothing a rule reruns for changed: nothing is read or run", async () => {
    await change({});

    expect(lock).not.toHaveBeenCalled();
    expect(ownerRules).not.toHaveBeenCalled();
    expect(onCallRules).not.toHaveBeenCalled();
  });
});

describe("an ongoing incident raised to a severity a rule matches", () => {
  test("its owner rules and on-call rules run again, saying why", async () => {
    await change({ isSeverityChanged: true });

    expect(ownerRules).toHaveBeenCalledWith(
      expect.objectContaining({ id: INCIDENT_ID }),
      "its severity changed",
    );
    expect(onCallRules).toHaveBeenCalledWith(
      expect.objectContaining({ id: INCIDENT_ID }),
      "its severity changed",
    );
  });

  test("reads the incident with what both engines match on, and the policies it has", async () => {
    await change({ isLabelsChanged: true });

    const select: Record<string, unknown> = (
      (IncidentService.findOneById as unknown as jest.Mock).mock
        .calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    for (const column of [
      "incidentSeverityId",
      "labels",
      "monitors",
      "title",
      "description",
      "onCallDutyPolicies",
    ]) {
      expect(select[column]).toBeTruthy();
    }
  });

  test("the responder policies the rules added page now, as responders", async () => {
    paging.addedPolicyIds = [RESPONDERS];

    await change({ isSeverityChanged: true });

    expect(executePolicy).toHaveBeenCalledTimes(1);
    expect(executePolicy.mock.calls[0]![0].toString()).toBe(RESPONDERS);
    expect(executePolicy.mock.calls[0]![1]).toEqual({
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    });
  });

  test("a responder policy a working-hours rule holds waits", async () => {
    const pagingStartsAt: Date = new Date(Date.now() + 60 * 60 * 1000);
    paging.addedPolicyIds = [RESPONDERS];
    paging.holds.set(RESPONDERS, {
      pagingStartsAt: pagingStartsAt,
      waitingStatusMessage: "Waiting.",
    });

    await change({ isSeverityChanged: true });

    expect(executePolicy.mock.calls[0]![1]).toMatchObject({
      pagingStartsAt: pagingStartsAt,
    });
  });

  test("the observer policies page as observers - but not those that paged about it before", async () => {
    paging.observerPolicyIds = [OBSERVERS];

    await change({ isLabelsChanged: true });

    expect(pageObservers).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      policyIds: [OBSERVERS],
      holds: paging.holds,
      record: {
        triggeredByIncidentId: INCIDENT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      },
      skipPoliciesPagedBefore: true,
    });
    expect(executePolicy).not.toHaveBeenCalled();
  });

  test("rules that page nothing new page nobody", async () => {
    await change({ isSeverityChanged: true });

    expect(executePolicy).not.toHaveBeenCalled();
    expect(pageObservers).not.toHaveBeenCalled();
  });
});

describe("what the rules never do", () => {
  test("run for a resolved incident", async () => {
    isResolved = true;

    await change({ isSeverityChanged: true });

    expect(ownerRules).not.toHaveBeenCalled();
    expect(onCallRules).not.toHaveBeenCalled();
  });

  test("run for an incident that is gone", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    await change({ isSeverityChanged: true });

    expect(onCallRules).not.toHaveBeenCalled();
  });

  test("fail the change: an engine that throws is logged, and the lock is given back", async () => {
    onCallRules.mockRejectedValue(new Error("rules are unreadable"));

    await expect(change({ isSeverityChanged: true })).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("one change of an incident at a time", () => {
  test("under a lock of its own, given back once the rules ran", async () => {
    await change({ isSeverityChanged: true });

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: INCIDENT_ID.toString(),
        namespace: "incident-rules-on-change",
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("a lock that cannot be taken still runs the rules: a page matters more", async () => {
    lock.mockRejectedValue(new Error("Redis is away"));

    await change({ isSeverityChanged: true });

    expect(onCallRules).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});
