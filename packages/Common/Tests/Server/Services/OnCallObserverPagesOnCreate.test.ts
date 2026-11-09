import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallNotRunOnCreate from "../../../Server/Utils/OnCall/OnCallNotRunOnCreate";
import OnCallObserverPaging from "../../../Server/Utils/OnCall/OnCallObserverPaging";
import { OnCallRulesPaging } from "../../../Server/Utils/OnCall/OnCallRulePageAs";
import { OnCallRulePagingHold } from "../../../Server/Utils/OnCall/OnCallRulePagingHold";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { StartingStage } from "../../../Utils/StartingStage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * THE POLICIES A CREATE'S ON-CALL RULES PAGE AS OBSERVERS, AS THE RECORD
 * STARTS (OnCallObserverPage, StartingStage).
 *
 * Each of the four records' on-call fan-out pages them with its own
 * policies, under the same rule: a record that starts open pages its
 * responders, then its observers; one created already acknowledged or
 * resolved pages no one, and its feed names the observers' policies with the
 * rest (OnCallNotRunOnCreate). A failure to page an observer never stops a
 * responder: they page first.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0ab00000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0ab00000-0000-4000-8000-000000000002",
);
const RESPONDERS: string = "0ab00000-0000-4000-8000-00000000000a";
const OBSERVERS: string = "0ab00000-0000-4000-8000-00000000000b";

type FanOut = (
  record: unknown,
  stage: StartingStage,
  paging: OnCallRulesPaging,
) => Promise<void>;

interface RecordKind {
  name: string;
  // The record as its create hands it to the fan-out, with its own policies.
  record: (policyIds: Array<string>) => unknown;
  fanOut: () => FanOut;
  // An episode's fan-out reads its policies again: they may not be loaded.
  readsItsPolicies?: (policyIds: Array<string>) => void;
  observerRecord: Record<string, unknown>;
  notRunRecord: Record<string, unknown>;
}

function policies(policyIds: Array<string>): Array<OnCallDutyPolicy> {
  return policyIds.map((policyId: string): OnCallDutyPolicy => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = policyId;
    policy.name = `Policy ${policyId.slice(-1)}`;
    return policy;
  });
}

function withIds<T extends Incident | Alert | AlertEpisode | IncidentEpisode>(
  item: T,
): T {
  item.id = RECORD_ID;
  item.projectId = PROJECT_ID;
  return item;
}

function fanOutOf(service: unknown, method: string): FanOut {
  const target: Record<string, FanOut> = service as unknown as Record<
    string,
    FanOut
  >;
  return target[method]!.bind(service);
}

const KINDS: Array<RecordKind> = [
  {
    name: "incident",
    record: (policyIds: Array<string>): unknown => {
      const incident: Incident = withIds(new Incident());
      incident.onCallDutyPolicies = policies(policyIds);
      return incident;
    },
    fanOut: (): FanOut => {
      return fanOutOf(IncidentService, "executeOnCallDutyPoliciesAsync");
    },
    observerRecord: {
      triggeredByIncidentId: RECORD_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    },
    notRunRecord: { incidentId: RECORD_ID },
  },
  {
    name: "alert",
    record: (policyIds: Array<string>): unknown => {
      const alert: Alert = withIds(new Alert());
      alert.onCallDutyPolicies = policies(policyIds);
      return alert;
    },
    fanOut: (): FanOut => {
      return fanOutOf(AlertService, "executeAlertOnCallDutyPoliciesAsync");
    },
    observerRecord: {
      triggeredByAlertId: RECORD_ID,
      userNotificationEventType: UserNotificationEventType.AlertCreated,
    },
    notRunRecord: { alertId: RECORD_ID },
  },
  {
    name: "alert episode",
    record: (): unknown => {
      return withIds(new AlertEpisode());
    },
    fanOut: (): FanOut => {
      return fanOutOf(
        AlertEpisodeService,
        "executeEpisodeOnCallDutyPoliciesAsync",
      );
    },
    readsItsPolicies: (policyIds: Array<string>): void => {
      const episode: AlertEpisode = withIds(new AlertEpisode());
      episode.onCallDutyPolicies = policies(policyIds);
      jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(episode);
      jest
        .spyOn(AlertEpisodeService, "updateOneById")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    observerRecord: {
      triggeredByAlertEpisodeId: RECORD_ID,
      userNotificationEventType: UserNotificationEventType.AlertEpisodeCreated,
    },
    notRunRecord: { alertEpisodeId: RECORD_ID },
  },
  {
    name: "incident episode",
    record: (): unknown => {
      return withIds(new IncidentEpisode());
    },
    fanOut: (): FanOut => {
      return fanOutOf(
        IncidentEpisodeService,
        "executeEpisodeOnCallDutyPoliciesAsync",
      );
    },
    readsItsPolicies: (policyIds: Array<string>): void => {
      const episode: IncidentEpisode = withIds(new IncidentEpisode());
      episode.onCallDutyPolicies = policies(policyIds);
      jest
        .spyOn(IncidentEpisodeService, "findOneById")
        .mockResolvedValue(episode);
      jest
        .spyOn(IncidentEpisodeService, "updateOneById")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    observerRecord: {
      triggeredByIncidentEpisodeId: RECORD_ID,
      userNotificationEventType:
        UserNotificationEventType.IncidentEpisodeCreated,
    },
    notRunRecord: { incidentEpisodeId: RECORD_ID },
  },
];

let executePolicy: jest.SpiedFunction<
  typeof OnCallDutyPolicyService.executePolicy
>;
let pageObservers: jest.SpiedFunction<typeof OnCallObserverPaging.pagePolicies>;
let notRun: jest.SpiedFunction<typeof OnCallNotRunOnCreate.createFeedItem>;

beforeEach(() => {
  executePolicy = jest
    .spyOn(OnCallDutyPolicyService, "executePolicy")
    .mockResolvedValue(undefined) as unknown as typeof executePolicy;
  pageObservers = jest
    .spyOn(OnCallObserverPaging, "pagePolicies")
    .mockResolvedValue([]) as unknown as typeof pageObservers;
  notRun = jest
    .spyOn(OnCallNotRunOnCreate, "createFeedItem")
    .mockResolvedValue(undefined) as unknown as typeof notRun;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function paging(observerPolicyIds: Array<string>): OnCallRulesPaging {
  return {
    addedPolicyIds: [],
    observerPolicyIds: observerPolicyIds,
    holds: new Map<string, OnCallRulePagingHold>(),
  };
}

async function create(
  kind: RecordKind,
  data: {
    stage: StartingStage;
    responders: Array<string>;
    observers: Array<string>;
  },
): Promise<OnCallRulesPaging> {
  kind.readsItsPolicies?.(data.responders);
  const rulesPaging: OnCallRulesPaging = paging(data.observers);
  await kind.fanOut()(kind.record(data.responders), data.stage, rulesPaging);
  return rulesPaging;
}

describe.each(KINDS)("a new $name", (kind: RecordKind) => {
  test("starting open: its responders page, then its observers, as observers", async () => {
    const rulesPaging: OnCallRulesPaging = await create(kind, {
      stage: StartingStage.Open,
      responders: [RESPONDERS],
      observers: [OBSERVERS],
    });

    expect(executePolicy).toHaveBeenCalledTimes(1);
    expect(executePolicy.mock.calls[0]![0].toString()).toBe(RESPONDERS);
    expect(pageObservers).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      policyIds: [OBSERVERS],
      holds: rulesPaging.holds,
      record: kind.observerRecord,
    });
    // Responders first: an observer's page never holds theirs up.
    expect(executePolicy.mock.invocationCallOrder[0]!).toBeLessThan(
      pageObservers.mock.invocationCallOrder[0]!,
    );
    expect(notRun).not.toHaveBeenCalled();
  });

  test("starting open, with only observers: they page, and no responder does", async () => {
    await create(kind, {
      stage: StartingStage.Open,
      responders: [],
      observers: [OBSERVERS],
    });

    expect(executePolicy).not.toHaveBeenCalled();
    expect(pageObservers).toHaveBeenCalledTimes(1);
    expect(pageObservers.mock.calls[0]![0].policyIds).toEqual([OBSERVERS]);
  });

  test.each([StartingStage.Acknowledged, StartingStage.Resolved])(
    "created already %s: no one is paged, and its feed names the observers' policies with the rest",
    async (stage: StartingStage) => {
      await create(kind, {
        stage: stage,
        responders: [RESPONDERS],
        observers: [OBSERVERS],
      });

      expect(executePolicy).not.toHaveBeenCalled();
      expect(pageObservers).not.toHaveBeenCalled();
      expect(notRun).toHaveBeenCalledTimes(1);

      const line: Parameters<typeof OnCallNotRunOnCreate.createFeedItem>[0] =
        notRun.mock.calls[0]![0];

      expect(line.record).toEqual(kind.notRunRecord);
      expect(line.stage).toBe(stage);
      expect(
        line.policies.map((policy: OnCallDutyPolicy): string => {
          return String(policy._id);
        }),
      ).toEqual([RESPONDERS, OBSERVERS]);
    },
  );

  test("created already acknowledged, with only observers: they are not paged either, and the feed says so", async () => {
    await create(kind, {
      stage: StartingStage.Acknowledged,
      responders: [],
      observers: [OBSERVERS],
    });

    expect(pageObservers).not.toHaveBeenCalled();
    expect(notRun).toHaveBeenCalledTimes(1);
  });

  test("no policies and no observers: nothing is paged, and nothing is said", async () => {
    await create(kind, {
      stage: StartingStage.Acknowledged,
      responders: [],
      observers: [],
    });

    expect(executePolicy).not.toHaveBeenCalled();
    expect(pageObservers).not.toHaveBeenCalled();
    expect(notRun).not.toHaveBeenCalled();
  });
});

describe("the observers' policies, as a record lists its policies", () => {
  test("each one's id, and nothing else, for the feed that names them", () => {
    const listed: Array<OnCallDutyPolicy> = OnCallObserverPaging.toPolicies([
      OBSERVERS,
      RESPONDERS,
    ]);

    expect(
      listed.map((policy: OnCallDutyPolicy): string => {
        return String(policy._id);
      }),
    ).toEqual([OBSERVERS, RESPONDERS]);
    expect(OnCallObserverPaging.toPolicies([])).toEqual([]);
  });
});
