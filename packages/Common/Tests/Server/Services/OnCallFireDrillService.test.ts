import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallFireDrillService from "../../../Server/Services/OnCallFireDrillService";
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
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE,
  ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE,
  ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE,
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

  test("names every policy the failure pages, with who its first level pages, read as its own test reads it - at the failure's kind and severity, and no walk", async () => {
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
    expect(readPreview).toHaveBeenCalledWith({
      projectId: PROJECT,
      callerUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: new ObjectID(CRITICAL),
      policyId: new ObjectID(PRIMARY),
      readsWalk: false,
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

describe("starting a drill", () => {
  async function start(
    data: {
      eventKey?: string;
      assertMayTestPolicy?: (policyId: ObjectID) => Promise<void>;
    } = {},
  ): Promise<OnCallFireDrillStarted> {
    return await OnCallFireDrillService.start({
      projectId: PROJECT,
      monitorId: MONITOR,
      sentByUserId: ANA,
      props: PROPS,
      eventKey: data.eventKey || OFFLINE_KEY,
      assertMayTestPolicy:
        data.assertMayTestPolicy ||
        (async (): Promise<void> => {
          return undefined;
        }),
    });
  }

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
    });
    expect(started).toEqual({
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
