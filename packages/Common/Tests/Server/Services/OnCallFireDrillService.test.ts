import OnCallDutyPolicyExecutionLogService, {
  OnCallFireDrillOfRun,
} from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallFireDrillService, {
  getOnCallFireDrillFailureRecord,
} from "../../../Server/Services/OnCallFireDrillService";
import OnCallTestPageService, {
  ON_CALL_TEST_PAGE_POLICY_LIMIT_NAMESPACE,
  OnCallTestPageLimitKey,
} from "../../../Server/Services/OnCallTestPageService";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import OnCallTestPageEvents from "../../../Server/Utils/OnCall/OnCallTestPageEvents";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import {
  WhoIsToldEvent,
  WhoIsToldPolicy,
  WhoIsToldResult,
  redactWhoIsTold,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE,
  ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE,
  ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE,
  OnCallFireDrillFailure,
  OnCallFireDrillPreview,
  OnCallFireDrillStarted,
  getOnCallFireDrillEventKey,
  getOnCallFireDrillFailures,
  getOnCallFireDrillPolicyTooSoonMessage,
  hasOnCallFireDrill,
} from "../../../Types/OnCallDutyPolicy/OnCallFireDrill";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
  OnCallTestPageCost,
  OnCallTestPageKind,
  OnCallTestPagePreview,
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN ON-CALL FIRE DRILL (#7012): a monitor's failure rehearsed as a test.
 *
 *   - It pages exactly the policies "When this goes down" says the failure
 *     pages (WhoIsToldService) - read afresh, as the caller may read the
 *     monitor, never from a list the request names.
 *   - Each policy is tested as "Test this policy" tests it: its first
 *     level, at the failure's kind and severity, a test page run each.
 *   - Who may run one: whoever may test every one of its policies; a drill
 *     with one they may not test starts nothing.
 *   - How often: every policy's window and the project's hour, all or none.
 */

const PROJECT: ObjectID = new ObjectID("7e5b2000-0000-4000-8000-000000000001");
const MONITOR: ObjectID = new ObjectID("7e5b2000-0000-4000-8000-000000000002");
const ANA: ObjectID = new ObjectID("7e5b2000-0000-4000-8000-0000000000a1");
const PRIMARY: string = "7e5b2000-0000-4000-8000-0000000000c1";
const PLATFORM: string = "7e5b2000-0000-4000-8000-0000000000c2";
const SECRET: string = "7e5b2000-0000-4000-8000-0000000000c3";
const CRITICAL: string = "7e5b2000-0000-4000-8000-0000000000d1";
const WARNING: string = "7e5b2000-0000-4000-8000-0000000000d2";
const RUN_1: ObjectID = new ObjectID("7e5b2000-0000-4000-8000-0000000000e1");
const RUN_2: ObjectID = new ObjectID("7e5b2000-0000-4000-8000-0000000000e2");

const PROPS: DatabaseCommonInteractionProps = {
  userId: ANA,
  tenantId: PROJECT,
};

function policy(
  id: string,
  name: string,
  data: Partial<WhoIsToldPolicy> = {},
): WhoIsToldPolicy {
  return {
    id: id,
    name: name,
    isHidden: false,
    isNamedByCriteria: false,
    ruleIds: [],
    levelCount: 1,
    people: [],
    notPaged: [],
    ...data,
  };
}

function event(data: Partial<WhoIsToldEvent>): WhoIsToldEvent {
  return {
    kind: OnCallTestPageRecordKind.Incident,
    id: "template-1",
    severityId: CRITICAL,
    title: "API is down",
    severityName: "Critical",
    owners: { kind: "None" } as unknown as WhoIsToldEvent["owners"],
    ownerRules: [],
    rules: [],
    policies: [],
    statusPages: [],
    ...data,
  };
}

/*
 * "When this goes down" for a monitor whose Offline criteria opens a
 * Critical incident - its criteria naming Primary, an on-call rule adding
 * Platform - and a Degraded criteria that opens a Warning alert paging
 * nobody, and an alert that pages Platform.
 */
function whoIsTold(): WhoIsToldResult {
  return {
    monitorId: MONITOR.toString(),
    monitorName: "API",
    checkedAt: "2026-11-17T09:00:00.000Z",
    criteria: [
      {
        id: "criteria-offline",
        name: "Offline",
        events: [
          event({
            policies: [
              policy(PRIMARY, "Primary", { isNamedByCriteria: true }),
              policy(PLATFORM, "Platform", { ruleIds: ["rule-1"] }),
            ],
            rules: [{ id: "rule-1", name: "Every critical incident" }],
          }),
        ],
      },
      {
        id: "criteria-degraded",
        name: "Degraded",
        events: [
          event({
            kind: OnCallTestPageRecordKind.Alert,
            id: "template-2",
            severityId: WARNING,
            severityName: "Warning",
            title: "API is slow",
            policies: [],
          }),
          event({
            kind: OnCallTestPageRecordKind.Alert,
            id: "template-3",
            severityId: WARNING,
            severityName: "Warning",
            title: "API is slow for everyone",
            policies: [policy(PLATFORM, "Platform")],
          }),
        ],
      },
    ],
    channels: {} as WhoIsToldResult["channels"],
    breaks: [],
  };
}

const OFFLINE_KEY: string = getOnCallFireDrillEventKey({
  criteriaId: "criteria-offline",
  recordKind: OnCallTestPageRecordKind.Incident,
  templateId: "template-1",
  index: 0,
});

const SLOW_FOR_EVERYONE_KEY: string = getOnCallFireDrillEventKey({
  criteriaId: "criteria-degraded",
  recordKind: OnCallTestPageRecordKind.Alert,
  templateId: "template-3",
  index: 1,
});

function person(
  name: string,
  channel: OnCallPageChannel,
): OnCallTestPagePreviewPerson {
  return {
    userId: `user-${name}`,
    userName: name,
    methods: [
      {
        channel: channel,
        notifyAfterMinutes: 0,
        isVerified: true,
        canAcknowledge: true,
      },
    ],
    hasNoRule: false,
    isOptedOut: false,
    warnings: [],
    warningCodes: [],
  };
}

function preview(
  people: Array<OnCallTestPagePreviewPerson>,
): OnCallTestPagePreview {
  return {
    kind: OnCallTestPageKind.Policy,
    people: people,
    notPaged: [],
    notPagedCodes: [],
    levelCount: 1,
    cost: {
      isPaid: false,
      smsCount: 0,
      callCount: 0,
      whatsAppCount: 0,
      telegramCount: 0,
    },
    walkLevels: [],
    walkUnreachedLevelCount: 0,
  };
}

let readWhoIsTold: jest.SpyInstance;
let readPreview: jest.SpyInstance;
let readCosts: jest.SpyInstance;
let startPolicyTest: jest.SpyInstance;
let claimLimits: jest.SpyInstance;
let readPolicy: jest.SpyInstance;
let readSeverity: jest.SpyInstance;
let sentEvents: jest.SpyInstance;

beforeEach(() => {
  readWhoIsTold = jest
    .spyOn(WhoIsToldService, "getForMonitor")
    .mockResolvedValue(whoIsTold() as never);
  readPreview = jest
    .spyOn(OnCallTestPageService, "getPreview")
    .mockImplementation((async (data: { policyId: ObjectID }) => {
      return data.policyId.toString() === PRIMARY
        ? preview([person("Ana Lopez", OnCallPageChannel.SMS)])
        : preview([
            person("Bob Stone", OnCallPageChannel.Call),
            person("Ana Lopez", OnCallPageChannel.SMS),
          ]);
    }) as never);
  readCosts = jest.spyOn(OnCallTestPageService, "getCosts").mockResolvedValue([
    {
      isPaid: true,
      smsCount: 2,
      callCount: 1,
      whatsAppCount: 0,
      telegramCount: 0,
    },
  ] as never);
  startPolicyTest = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "startPolicyTest")
    .mockResolvedValueOnce(RUN_1 as never)
    .mockResolvedValueOnce(RUN_2 as never);
  claimLimits = jest
    .spyOn(OnCallTestPageService, "claimLimitsOfEach")
    .mockResolvedValue(undefined as never);
  readPolicy = jest
    .spyOn(OnCallTestPageService, "readPolicy")
    .mockResolvedValue({} as never);
  readSeverity = jest
    .spyOn(OnCallTestPageService, "readSeverity")
    .mockResolvedValue("Critical" as never);
  sentEvents = jest
    .spyOn(OnCallTestPageEvents, "onTestPageSent")
    .mockImplementation(() => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function mayTestEvery(): Promise<boolean> {
  return true;
}

describe("the failures a drill can rehearse", () => {
  test("each incident or alert a criteria opens that pages a policy, in the order the criteria are checked", () => {
    const failures: ReturnType<typeof getOnCallFireDrillFailures> =
      getOnCallFireDrillFailures(whoIsTold());

    expect(
      failures.map((failure: { key: string }) => {
        return failure.key;
      }),
    ).toEqual([OFFLINE_KEY, SLOW_FOR_EVERYONE_KEY]);
  });

  test("one with no severity to test it at - an older server's answer - is left out", () => {
    const result: WhoIsToldResult = whoIsTold();
    delete result.criteria[0]!.events[0]!.severityId;

    expect(
      getOnCallFireDrillFailures(result).map((failure: { key: string }) => {
        return failure.key;
      }),
    ).toEqual([SLOW_FOR_EVERYONE_KEY]);
  });

  test("a monitor has a drill when one of its failures pages a policy, and none when none does", () => {
    expect(hasOnCallFireDrill(whoIsTold())).toBe(true);

    const result: WhoIsToldResult = whoIsTold();

    for (const criteria of result.criteria) {
      for (const each of criteria.events) {
        each.policies = [];
      }
    }

    expect(hasOnCallFireDrill(result)).toBe(false);
  });

  test("a failure is told apart by its criteria, its kind, its template and its place", () => {
    expect(OFFLINE_KEY).toBe("criteria-offline:Incident:template-1:0");
    expect(
      getOnCallFireDrillEventKey({
        criteriaId: "c",
        recordKind: OnCallTestPageRecordKind.Alert,
        templateId: undefined,
        index: 2,
      }),
    ).toBe("c:Alert::2");
  });
});

describe("the preview", () => {
  test("reads the monitor afresh, as the caller may read it, and lists every failure that pages a policy", async () => {
    const drill: OnCallFireDrillPreview =
      await OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: mayTestEvery,
      });

    expect(readWhoIsTold).toHaveBeenCalledWith({
      projectId: PROJECT,
      monitorId: MONITOR,
      props: PROPS,
      refresh: true,
    });
    expect(drill.monitorName).toBe("API");
    expect(drill.events).toEqual([
      {
        key: OFFLINE_KEY,
        criteriaName: "Offline",
        recordKind: OnCallTestPageRecordKind.Incident,
        severityName: "Critical",
        title: "API is down",
        policyCount: 2,
      },
      {
        key: SLOW_FOR_EVERYONE_KEY,
        criteriaName: "Degraded",
        recordKind: OnCallTestPageRecordKind.Alert,
        severityName: "Warning",
        title: "API is slow for everyone",
        policyCount: 1,
      },
    ]);
    // With none asked for, the first.
    expect(drill.eventKey).toBe(OFFLINE_KEY);
  });

  test("names every policy the failure pages, with who its first level pages, read as its own test reads it - at the failure's kind and severity, its walk included (#9385)", async () => {
    const drill: OnCallFireDrillPreview =
      await OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: mayTestEvery,
      });

    expect(
      drill.policies.map((each: OnCallFireDrillPreview["policies"][number]) => {
        return [each.policyId, each.policyName, each.mayTest];
      }),
    ).toEqual([
      [PRIMARY, "Primary", true],
      [PLATFORM, "Platform", true],
    ]);
    expect(readPreview).toHaveBeenCalledTimes(2);
    // Exactly as Test this policy's preview: the walk is read as its own is.
    expect(readPreview).toHaveBeenCalledWith({
      projectId: PROJECT,
      callerUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: new ObjectID(CRITICAL),
      policyId: new ObjectID(PRIMARY),
    });
    expect(drill.policies[1]!.preview!.people).toHaveLength(2);
  });

  test("prices every policy's first level together: a person two policies page is paged, and counted, twice", async () => {
    const drill: OnCallFireDrillPreview =
      await OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: mayTestEvery,
      });

    const people: Array<OnCallTestPagePreviewPerson> = (
      readCosts.mock.calls[0]![0] as {
        peopleOfEach: Array<Array<OnCallTestPagePreviewPerson>>;
      }
    ).peopleOfEach[0]!;

    expect(
      people.map((each: OnCallTestPagePreviewPerson) => {
        return each.userName;
      }),
    ).toEqual(["Ana Lopez", "Bob Stone", "Ana Lopez"]);
    expect(drill.cost.smsCount).toBe(2);
  });

  test("the failure asked for, by its key", async () => {
    const drill: OnCallFireDrillPreview =
      await OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        eventKey: SLOW_FOR_EVERYONE_KEY,
        mayTestPolicy: mayTestEvery,
      });

    expect(drill.eventKey).toBe(SLOW_FOR_EVERYONE_KEY);
    expect(
      drill.policies.map((each: OnCallFireDrillPreview["policies"][number]) => {
        return each.policyId;
      }),
    ).toEqual([PLATFORM]);
    expect(readPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        recordKind: OnCallTestPageRecordKind.Alert,
        severityId: new ObjectID(WARNING),
      }),
    );
  });

  test("a policy the caller may not test is named, and who it pages is not read", async () => {
    const drill: OnCallFireDrillPreview =
      await OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: async (policyId: ObjectID): Promise<boolean> => {
          return policyId.toString() !== PLATFORM;
        },
      });

    expect(drill.policies[1]).toEqual({
      policyId: PLATFORM,
      policyName: "Platform",
      mayTest: false,
    });
    expect(readPreview).toHaveBeenCalledTimes(1);
  });

  test("a policy the caller may not read is named by nothing, and not even asked about", async () => {
    const result: WhoIsToldResult = whoIsTold();
    result.criteria[0]!.events[0]!.policies[1] = policy(PLATFORM, "", {
      isHidden: true,
    });
    readWhoIsTold.mockResolvedValue(result as never);
    const mayTest: jest.Mock = jest.fn(async () => {
      return true;
    });

    const drill: OnCallFireDrillPreview =
      await OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: mayTest as never,
      });

    expect(drill.policies[1]).toEqual({
      policyId: PLATFORM,
      policyName: "",
      mayTest: false,
    });
    expect(mayTest).toHaveBeenCalledTimes(1);
  });

  test("a failure that is no longer there says the monitor changed", async () => {
    await expect(
      OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        eventKey: "criteria-offline:Incident:template-1:7",
        mayTestPolicy: mayTestEvery,
      }),
    ).rejects.toThrow(
      new BadDataException(ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE),
    );
  });

  test("a monitor that pages nobody has nothing to drill", async () => {
    const result: WhoIsToldResult = whoIsTold();
    result.criteria = [];
    readWhoIsTold.mockResolvedValue(result as never);

    await expect(
      OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: mayTestEvery,
      }),
    ).rejects.toThrow(ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE);
  });

  test("a monitor the caller may not read is not found, as When this goes down says", async () => {
    readWhoIsTold.mockRejectedValue(
      new BadDataException("Monitor not found.") as never,
    );

    await expect(
      OnCallFireDrillService.getPreview({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: PROPS,
        mayTestPolicy: mayTestEvery,
      }),
    ).rejects.toThrow("Monitor not found.");
    expect(readPreview).not.toHaveBeenCalled();
  });
});

async function start(
  data: {
    eventKey?: string;
    walksEscalation?: boolean | undefined;
    assertMayTestPolicy?: (policyId: ObjectID) => Promise<void>;
  } = {},
): Promise<OnCallFireDrillStarted> {
  return await OnCallFireDrillService.start({
    projectId: PROJECT,
    monitorId: MONITOR,
    sentByUserId: ANA,
    props: PROPS,
    eventKey: data.eventKey || OFFLINE_KEY,
    walksEscalation: data.walksEscalation,
    assertMayTestPolicy:
      data.assertMayTestPolicy ||
      (async (): Promise<void> => {
        return undefined;
      }),
  });
}

// What each policy's test of a drill was started with.
function startedWith(): Array<{
  onCallDutyPolicyId: ObjectID;
  recordKind: OnCallTestPageRecordKind;
  severityId: ObjectID;
  walksEscalation: boolean;
  fireDrill: OnCallFireDrillOfRun;
}> {
  return startPolicyTest.mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      onCallDutyPolicyId: ObjectID;
      recordKind: OnCallTestPageRecordKind;
      severityId: ObjectID;
      walksEscalation: boolean;
      fireDrill: OnCallFireDrillOfRun;
    };
  });
}

describe("starting a drill", () => {
  test("tests exactly the policies When this goes down says the failure pages: its first level each, at its kind and severity", async () => {
    const started: OnCallFireDrillStarted = await start();

    // Read afresh as it starts: never the dialog's copy.
    expect(readWhoIsTold).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: true, props: PROPS }),
    );

    const offline: WhoIsToldEvent = whoIsTold().criteria[0]!.events[0]!;

    expect(
      startPolicyTest.mock.calls.map((call: Array<unknown>) => {
        return (
          call[0] as { onCallDutyPolicyId: ObjectID }
        ).onCallDutyPolicyId.toString();
      }),
    ).toEqual(
      offline.policies.map((each: WhoIsToldPolicy) => {
        return each.id;
      }),
    );
    expect(startPolicyTest).toHaveBeenCalledWith({
      projectId: PROJECT,
      onCallDutyPolicyId: new ObjectID(PRIMARY),
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: new ObjectID(CRITICAL),
      walksEscalation: false,
      startedByUserId: ANA,
      fireDrill: {
        fireDrillId: new ObjectID(started.fireDrillId!),
        monitorId: MONITOR,
        failure: { criteriaName: "Offline" },
      },
    });
    expect(started).toEqual({
      fireDrillId: expect.any(String),
      runs: [
        {
          policyId: PRIMARY,
          policyName: "Primary",
          executionLogId: RUN_1.toString(),
        },
        {
          policyId: PLATFORM,
          policyName: "Platform",
          executionLogId: RUN_2.toString(),
        },
      ],
    });
  });

  test("each test is a policy's test, counted as one sent", async () => {
    await start();

    expect(sentEvents).toHaveBeenCalledTimes(2);
    expect(sentEvents).toHaveBeenCalledWith({
      projectId: PROJECT,
      executionLogId: RUN_1,
      sentByUserId: ANA,
      kind: OnCallTestPageKind.Policy,
      recordKind: OnCallTestPageRecordKind.Incident,
    });
  });

  test("claims every policy's window and the project's hour at once, before anything is sent", async () => {
    await start();

    expect(claimLimits).toHaveBeenCalledTimes(1);
    expect(claimLimits).toHaveBeenCalledWith({
      projectId: PROJECT,
      keys: [PRIMARY, PLATFORM].map((id: string): OnCallTestPageLimitKey => {
        return {
          namespace: ON_CALL_TEST_PAGE_POLICY_LIMIT_NAMESPACE,
          id: new ObjectID(id),
          intervalInSeconds: ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
          tooSoonMessage: getOnCallFireDrillPolicyTooSoonMessage({
            policyName: id === PRIMARY ? "Primary" : "Platform",
            waitInSeconds: ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
          }),
        };
      }),
    });
    expect(ON_CALL_TEST_PAGE_POLICY_LIMIT_NAMESPACE).toBe(
      "oncall-test-page-policy",
    );
    expect(claimLimits.mock.invocationCallOrder[0]!).toBeLessThan(
      startPolicyTest.mock.invocationCallOrder[0]!,
    );
  });

  test("a policy tested a moment ago refuses the whole drill: nothing is sent", async () => {
    claimLimits.mockRejectedValue(
      new TooManyRequestsException(
        getOnCallFireDrillPolicyTooSoonMessage({
          policyName: "Platform",
          waitInSeconds: 300,
        }),
      ) as never,
    );

    await expect(start()).rejects.toThrow(
      "On-call policy Platform was tested a moment ago, so the fire drill was not started. Wait 5 minutes, then run it again.",
    );
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("one policy the caller may not test refuses the whole drill: nothing is claimed or sent", async () => {
    await expect(
      start({
        assertMayTestPolicy: async (policyId: ObjectID): Promise<void> => {
          if (policyId.toString() === PLATFORM) {
            throw new NotAuthorizedException(
              ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE,
            );
          }
        },
      }),
    ).rejects.toThrow(ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE);

    expect(claimLimits).not.toHaveBeenCalled();
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("a failure that changed since the dialog opened pages nothing", async () => {
    const result: WhoIsToldResult = whoIsTold();
    result.criteria[0]!.events[0]!.id = "template-9";
    readWhoIsTold.mockResolvedValue(result as never);

    await expect(start()).rejects.toThrow(
      ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE,
    );
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("a policy added to the failure since the dialog opened is paged too: the server's list, never the dialog's", async () => {
    const result: WhoIsToldResult = whoIsTold();
    result.criteria[0]!.events[0]!.policies.push(policy(SECRET, "Secret"));
    readWhoIsTold.mockResolvedValue(result as never);
    startPolicyTest.mockResolvedValue(RUN_2 as never);

    const started: OnCallFireDrillStarted = await start();

    expect(
      started.runs.map((run: { policyId: string }) => {
        return run.policyId;
      }),
    ).toEqual([PRIMARY, PLATFORM, SECRET]);
  });

  test("the severity and the policies are checked to be the project's, as a policy's test checks them", async () => {
    await start();

    expect(readSeverity).toHaveBeenCalledWith({
      projectId: PROJECT,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: new ObjectID(CRITICAL),
    });
    expect(readPolicy).toHaveBeenCalledTimes(2);
    expect(readPolicy).toHaveBeenCalledWith({
      projectId: PROJECT,
      policyId: new ObjectID(PLATFORM),
    });
  });
});

async function previewOf(
  eventKey?: string | undefined,
): Promise<OnCallFireDrillPreview> {
  return await OnCallFireDrillService.getPreview({
    projectId: PROJECT,
    monitorId: MONITOR,
    callerUserId: ANA,
    props: PROPS,
    eventKey: eventKey,
    mayTestPolicy: mayTestEvery,
  });
}

function keysOf(result: WhoIsToldResult): Array<string> {
  return getOnCallFireDrillFailures(result).map(
    (failure: OnCallFireDrillFailure): string => {
      return failure.key;
    },
  );
}

/*
 * #9385: WALKING EVERY ESCALATION LEVEL OF EACH POLICY. Off unless asked
 * with true; each policy's test is then a walked one, as Test this policy's
 * walk is - and still one test of each policy against the limits. Its
 * preview reads each policy's walk as that policy's own test reads it, and
 * prices the walk at most.
 */
describe("a drill that walks every escalation level (#9385)", () => {
  function walked(
    people: Array<OnCallTestPagePreviewPerson>,
    later: Array<OnCallTestPagePreviewPerson>,
  ): OnCallTestPagePreview {
    return {
      ...preview(people),
      levelCount: 2,
      walkLevels: [
        {
          order: 2,
          startsAfterMinutes: 2,
          people: later,
          notPaged: [],
          notPagedCodes: [],
        },
      ],
      walkUnreachedLevelCount: 0,
    };
  }

  test("each policy's test walks its levels when the drill is asked to", async () => {
    await start({ walksEscalation: true });

    expect(
      startedWith().map(
        (each: { onCallDutyPolicyId: ObjectID; walksEscalation: boolean }) => {
          return [each.onCallDutyPolicyId.toString(), each.walksEscalation];
        },
      ),
    ).toEqual([
      [PRIMARY, true],
      [PLATFORM, true],
    ]);
  });

  test("off unless asked: each policy's first level only", async () => {
    await start();

    expect(
      startedWith().map((each: { walksEscalation: boolean }) => {
        return each.walksEscalation;
      }),
    ).toEqual([false, false]);
  });

  test("a walk is still one test of each policy: every window and the project's hour, claimed once before anything is sent", async () => {
    await start({ walksEscalation: true });

    expect(claimLimits).toHaveBeenCalledTimes(1);
    expect(
      (
        claimLimits.mock.calls[0]![0] as {
          keys: Array<OnCallTestPageLimitKey>;
        }
      ).keys.map((key: OnCallTestPageLimitKey) => {
        return key.id.toString();
      }),
    ).toEqual([PRIMARY, PLATFORM]);
    expect(claimLimits.mock.invocationCallOrder[0]!).toBeLessThan(
      startPolicyTest.mock.invocationCallOrder[0]!,
    );
  });

  test("a walk a policy's window refuses sends nothing to any policy", async () => {
    claimLimits.mockRejectedValue(
      new TooManyRequestsException(
        getOnCallFireDrillPolicyTooSoonMessage({
          policyName: "Primary",
          waitInSeconds: 300,
        }),
      ) as never,
    );

    await expect(start({ walksEscalation: true })).rejects.toThrow(
      "On-call policy Primary was tested a moment ago",
    );
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("the preview hands on each policy's walk, as its own test's preview reads it", async () => {
    const primary: OnCallTestPagePreview = walked(
      [person("Ana Lopez", OnCallPageChannel.SMS)],
      [person("Cara Diaz", OnCallPageChannel.Call)],
    );

    readPreview.mockImplementation((async (data: { policyId: ObjectID }) => {
      return data.policyId.toString() === PRIMARY
        ? primary
        : preview([person("Bob Stone", OnCallPageChannel.Call)]);
    }) as never);

    const drill: OnCallFireDrillPreview = await previewOf();

    expect(drill.policies[0]!.preview!.walkLevels).toEqual(primary.walkLevels);
    expect(drill.policies[0]!.preview!.levelCount).toBe(2);
  });

  test("prices the walk at most: every policy's first level and each level its walk reaches", async () => {
    readPreview.mockImplementation((async (data: { policyId: ObjectID }) => {
      return data.policyId.toString() === PRIMARY
        ? walked(
            [person("Ana Lopez", OnCallPageChannel.SMS)],
            [person("Cara Diaz", OnCallPageChannel.Call)],
          )
        : preview([
            person("Bob Stone", OnCallPageChannel.Call),
            person("Ana Lopez", OnCallPageChannel.SMS),
          ]);
    }) as never);

    const firstLevels: OnCallTestPageCost = {
      isPaid: true,
      smsCount: 2,
      callCount: 1,
      whatsAppCount: 0,
      telegramCount: 0,
    };
    const walk: OnCallTestPageCost = { ...firstLevels, callCount: 2 };

    readCosts.mockResolvedValue([firstLevels, walk] as never);

    const drill: OnCallFireDrillPreview = await previewOf();
    const peopleOfEach: Array<Array<OnCallTestPagePreviewPerson>> = (
      readCosts.mock.calls[0]![0] as {
        peopleOfEach: Array<Array<OnCallTestPagePreviewPerson>>;
      }
    ).peopleOfEach;

    const names: (
      people: Array<OnCallTestPagePreviewPerson>,
    ) => Array<string> = (
      people: Array<OnCallTestPagePreviewPerson>,
    ): Array<string> => {
      return people.map((each: OnCallTestPagePreviewPerson) => {
        return each.userName;
      });
    };

    // One read of the project's prices, for both.
    expect(readCosts).toHaveBeenCalledTimes(1);
    expect(peopleOfEach).toHaveLength(2);
    expect(names(peopleOfEach[0]!)).toEqual([
      "Ana Lopez",
      "Bob Stone",
      "Ana Lopez",
    ]);
    expect(names(peopleOfEach[1]!)).toEqual([
      "Ana Lopez",
      "Cara Diaz",
      "Bob Stone",
      "Ana Lopez",
    ]);
    expect(drill.cost).toEqual(firstLevels);
    expect(drill.walkCost).toEqual(walk);
  });
});

/*
 * #9397: THE INCIDENT AN ALERT INCIDENT RULE DECLARES, a failure of its own.
 * When this goes down shows it under the alert it is declared from
 * (WhoIsToldEvent.declares); a drill offers it after that alert, at the
 * incident's kind and severity, keyed apart from the alert - and never
 * one the reader can't see.
 */
const DECLARED_SEVERITY: string = "7e5b2000-0000-4000-8000-0000000000d3";

const DECLARED_KEY: string = getOnCallFireDrillEventKey({
  criteriaId: "criteria-degraded",
  recordKind: OnCallTestPageRecordKind.Incident,
  templateId: "template-2",
  index: 0,
  isDeclared: true,
});

/*
 * When this goes down where the Degraded criteria's first alert, which
 * pages nobody itself, becomes after 30 minutes a Major incident that
 * pages Primary.
 */
function withDeclaration(
  data: {
    rule?: string;
    wait?: number;
    incident?: Partial<WhoIsToldEvent>;
    alert?: Partial<WhoIsToldEvent>;
  } = {},
): WhoIsToldResult {
  const result: WhoIsToldResult = whoIsTold();
  const alert: WhoIsToldEvent = result.criteria[1]!.events[0]!;

  Object.assign(alert, data.alert || {});
  alert.declares = {
    rule: {
      id: "alert-incident-rule-1",
      name: data.rule ?? "Escalate slow alerts",
    },
    waitInMinutes: data.wait ?? 30,
    incident: event({
      kind: OnCallTestPageRecordKind.Incident,
      id: "",
      severityId: DECLARED_SEVERITY,
      severityName: "Major",
      title: "API is slow (declared)",
      policies: [policy(PRIMARY, "Primary", { ruleIds: ["rule-2"] })],
      ...data.incident,
    }),
  };

  return result;
}

// The answer as a reader is told it, a private record theirs or not.
function asReadBy(
  result: WhoIsToldResult,
  mayReadPrivate: boolean,
): WhoIsToldResult {
  return redactWhoIsTold({
    result: result,
    readablePolicyIds: new Set<string>([PRIMARY, PLATFORM, SECRET]),
    readableRuleIds: new Set<string>(),
    readableOwnerRuleIds: new Set<string>(),
    readableStatusPageIds: new Set<string>(),
    readableAlertIncidentRuleIds: new Set<string>(["alert-incident-rule-1"]),
    canReadPrivateEvent: (): boolean => {
      return mayReadPrivate;
    },
  });
}

describe("the incident an alert incident rule declares (#9397)", () => {
  test("is a failure of its own, right after its alert, keyed apart from it", () => {
    expect(keysOf(withDeclaration())).toEqual([
      OFFLINE_KEY,
      DECLARED_KEY,
      SLOW_FOR_EVERYONE_KEY,
    ]);
    expect(DECLARED_KEY).toBe(
      "criteria-degraded:Incident:template-2:0:declared",
    );
  });

  test("its alert, when it pages a policy itself, is a failure too: the two never share a key", () => {
    const keys: Array<string> = keysOf(
      withDeclaration({ alert: { policies: [policy(PLATFORM, "Platform")] } }),
    );

    expect(keys).toEqual([
      OFFLINE_KEY,
      "criteria-degraded:Alert:template-2:0",
      DECLARED_KEY,
      SLOW_FOR_EVERYONE_KEY,
    ]);
    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  test("is rehearsed at its own kind and severity - the rule's incident's, not its alert's", () => {
    const failure: OnCallFireDrillFailure | undefined =
      getOnCallFireDrillFailures(withDeclaration()).find(
        (each: OnCallFireDrillFailure): boolean => {
          return each.key === DECLARED_KEY;
        },
      );

    expect(failure?.event.kind).toBe(OnCallTestPageRecordKind.Incident);
    expect(failure?.event.severityId).toBe(DECLARED_SEVERITY);
    expect(failure?.criteria.name).toBe("Degraded");
    expect(failure?.declaration?.rule.name).toBe("Escalate slow alerts");
    expect(failure?.declaration?.waitInMinutes).toBe(30);
  });

  test("gives a monitor a drill though nothing its criteria open pages anybody itself", () => {
    const result: WhoIsToldResult = withDeclaration();
    result.criteria[0]!.events[0]!.policies = [];
    result.criteria[1]!.events[1]!.policies = [];

    expect(hasOnCallFireDrill(result)).toBe(true);
    expect(keysOf(result)).toEqual([DECLARED_KEY]);
  });

  test("a private one that is not the reader's - as the card hides it - is never offered", () => {
    const hidden: WhoIsToldResult = asReadBy(
      withDeclaration({
        incident: {
          isPrivate: true,
          ownerIds: { userIds: [], teamIds: [] },
        },
      }),
      false,
    );

    expect(hidden.criteria[1]!.events[0]!.declares!.incident.isHidden).toBe(
      true,
    );
    expect(keysOf(hidden)).toEqual([OFFLINE_KEY, SLOW_FOR_EVERYONE_KEY]);
  });

  test("a private one the reader may read - an owner, a Project Admin - is offered", () => {
    const shown: WhoIsToldResult = asReadBy(
      withDeclaration({
        incident: {
          isPrivate: true,
          ownerIds: { userIds: [ANA.toString()], teamIds: [] },
        },
      }),
      true,
    );

    expect(keysOf(shown)).toContain(DECLARED_KEY);
  });

  test("a hidden one is never offered, whatever it says it pages", () => {
    expect(
      keysOf(withDeclaration({ incident: { isHidden: true } })),
    ).not.toContain(DECLARED_KEY);
  });

  test("an alert the reader may not see says nothing of what it declares", () => {
    expect(
      keysOf(withDeclaration({ alert: { isHidden: true } })),
    ).not.toContain(DECLARED_KEY);
  });

  test("one that pages nobody, or says no severity to test it at, is not offered", () => {
    expect(
      keysOf(withDeclaration({ incident: { policies: [] } })),
    ).not.toContain(DECLARED_KEY);
    expect(
      keysOf(withDeclaration({ incident: { severityId: undefined } })),
    ).not.toContain(DECLARED_KEY);
  });

  test("the preview names it with its rule and how long its alert stays open first, and reads its policies at its severity", async () => {
    readWhoIsTold.mockResolvedValue(withDeclaration() as never);

    const drill: OnCallFireDrillPreview = await previewOf(DECLARED_KEY);

    expect(drill.eventKey).toBe(DECLARED_KEY);
    expect(drill.events[1]).toEqual({
      key: DECLARED_KEY,
      criteriaName: "Degraded",
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "Major",
      title: "API is slow (declared)",
      policyCount: 1,
      declaredBy: { ruleName: "Escalate slow alerts", waitInMinutes: 30 },
    });
    // What a criteria opens itself is declared by no rule.
    expect(drill.events[0]!.declaredBy).toBeUndefined();
    expect(
      drill.policies.map((each: OnCallFireDrillPreview["policies"][number]) => {
        return each.policyId;
      }),
    ).toEqual([PRIMARY]);
    expect(readPreview).toHaveBeenCalledWith({
      projectId: PROJECT,
      callerUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: new ObjectID(DECLARED_SEVERITY),
      policyId: new ObjectID(PRIMARY),
    });
  });

  test("a rule the reader may not read is named by nothing; one declared right away waits 0", async () => {
    readWhoIsTold.mockResolvedValue(
      withDeclaration({ rule: "", wait: 0 }) as never,
    );

    const drill: OnCallFireDrillPreview = await previewOf(DECLARED_KEY);

    expect(drill.events[1]!.declaredBy).toEqual({
      ruleName: "",
      waitInMinutes: 0,
    });
  });

  test("starting it tests the incident's policies at the incident's kind and severity, and keeps how long its alert waits", async () => {
    readWhoIsTold.mockResolvedValue(withDeclaration() as never);
    startPolicyTest.mockReset().mockResolvedValue(RUN_1 as never);

    const started: OnCallFireDrillStarted = await start({
      eventKey: DECLARED_KEY,
    });

    expect(startedWith()).toEqual([
      {
        projectId: PROJECT,
        onCallDutyPolicyId: new ObjectID(PRIMARY),
        recordKind: OnCallTestPageRecordKind.Incident,
        severityId: new ObjectID(DECLARED_SEVERITY),
        walksEscalation: false,
        startedByUserId: ANA,
        fireDrill: {
          fireDrillId: new ObjectID(started.fireDrillId!),
          monitorId: MONITOR,
          failure: { criteriaName: "Degraded", declaredAfterMinutes: 30 },
        },
      },
    ]);
    expect(readSeverity).toHaveBeenCalledWith({
      projectId: PROJECT,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: new ObjectID(DECLARED_SEVERITY),
    });
  });

  test("once the rule no longer declares it, starting it pages nothing", async () => {
    await expect(start({ eventKey: DECLARED_KEY })).rejects.toThrow(
      ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE,
    );
    expect(claimLimits).not.toHaveBeenCalled();
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("nor can a private one hidden from the reader be started by its key", async () => {
    readWhoIsTold.mockResolvedValue(
      asReadBy(
        withDeclaration({
          incident: {
            isPrivate: true,
            ownerIds: { userIds: [], teamIds: [] },
          },
        }),
        false,
      ) as never,
    );

    await expect(start({ eventKey: DECLARED_KEY })).rejects.toThrow(
      ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE,
    );
    expect(startPolicyTest).not.toHaveBeenCalled();
  });
});

/*
 * #9386: WHAT A DRILL KEEPS. Each policy's test it starts is kept with the
 * drill - the same on every test it started - the monitor whose failure it
 * rehearsed and that failure, so the monitor's card can say how its last
 * drill went, and the run's row says it was part of one.
 */
describe("what a drill keeps (#9386)", () => {
  test("every policy's test of one drill is kept with the same drill, the monitor and the failure", async () => {
    const started: OnCallFireDrillStarted = await start();
    const drills: Array<OnCallFireDrillOfRun> = startedWith().map(
      (each: { fireDrill: OnCallFireDrillOfRun }) => {
        return each.fireDrill;
      },
    );

    expect(drills).toHaveLength(2);
    expect(drills[0]).toEqual(drills[1]);
    expect(drills[0]!.fireDrillId.toString()).toBe(started.fireDrillId);
    expect(drills[0]!.monitorId).toEqual(MONITOR);
    expect(drills[0]!.failure).toEqual({ criteriaName: "Offline" });
  });

  test("each drill is kept apart from the one before it", async () => {
    startPolicyTest.mockReset().mockResolvedValue(RUN_1 as never);

    const first: OnCallFireDrillStarted = await start();
    const second: OnCallFireDrillStarted = await start();

    expect(first.fireDrillId).toBeTruthy();
    expect(second.fireDrillId).toBeTruthy();
    expect(first.fireDrillId).not.toBe(second.fireDrillId);
  });

  test("a drill that is refused keeps nothing: no test is started", async () => {
    claimLimits.mockRejectedValue(new TooManyRequestsException("no") as never);

    await expect(start()).rejects.toThrow("no");
    expect(startPolicyTest).not.toHaveBeenCalled();
  });

  test("of the failure: the criteria's name, and a declared incident's wait", () => {
    const criteria: WhoIsToldResult["criteria"][number] =
      whoIsTold().criteria[0]!;

    expect(getOnCallFireDrillFailureRecord({ criteria: criteria })).toEqual({
      criteriaName: "Offline",
    });
    expect(
      getOnCallFireDrillFailureRecord({
        criteria: criteria,
        declaration: withDeclaration().criteria[1]!.events[0]!.declares,
      }),
    ).toEqual({ criteriaName: "Offline", declaredAfterMinutes: 30 });
    expect(
      getOnCallFireDrillFailureRecord({
        criteria: criteria,
        declaration: withDeclaration({ wait: 0 }).criteria[1]!.events[0]!
          .declares,
      }),
    ).toEqual({ criteriaName: "Offline", declaredAfterMinutes: 0 });
  });
});

/*
 * WHICH POLICIES A FAILURE PAGES IS WORKED OUT ONCE (#7012): by "When this
 * goes down" (WhoIsToldService), which asks the code a real failure is paged
 * by. The drill reads it, and never matches rules or reads a criteria's
 * policies itself - a second copy would drift from what really pages.
 */
describe("the drill reuses what decides which policies a failure pages", () => {
  // The service's code, its comments - which name what it reuses - left out.
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "../../../Server/Services/OnCallFireDrillService.ts",
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("it reads When this goes down", () => {
    expect(source).toContain(
      'import WhoIsToldService from "./WhoIsToldService";',
    );
    expect(source).toContain("WhoIsToldService.getForMonitor(");
  });

  test("it matches no rule and reads no criteria's policies of its own", () => {
    for (const copy of [
      "getMatchingRules",
      "OnCallRuleEngineService",
      "onCallPolicyIds",
      "MonitorService",
      "IncidentOnCallRuleService",
      "AlertOnCallRuleService",
    ]) {
      expect({ copy, found: source.includes(copy) }).toEqual({
        copy,
        found: false,
      });
    }
  });
});
