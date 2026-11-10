import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE AN ON-CALL PAGE STARTS, FOR ITS TIME TO SEND (OnCallPageTiming,
 * notification.time_to_send, issue #6600).
 *
 * The real OnCallDutyPolicyExecutionLogService: a run pages its first
 * escalation rule inside its page's start, so every notification that rule
 * sends at once is due then - at the record's creation, for a run started as
 * its record was created (the monitor trigger), and at the moment it starts
 * paging for any other: one a person started, one that waited out a hold.
 * A level the run moves on to at once, finding nobody before it, is due at
 * the same start. The escalation rule's paging and the database are stood
 * in for.
 *
 * The paths that start pages without a run's first rule - a page again, a
 * direct page - and the records' fan-outs are held to the same by the guard
 * at the end, which reads the services' source.
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

import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallEscalationAdvance from "../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "../../../Server/Utils/OnCall/OnCallPageTiming";
import { OnCallPageStart } from "../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import fs from "fs";
import path from "path";

type AnyFunction = (...args: Array<unknown>) => Promise<unknown>;

const PROJECT: ObjectID = new ObjectID("6600cccc-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("6600cccc-0000-4000-8000-000000000002");
const RUN: ObjectID = new ObjectID("6600cccc-0000-4000-8000-000000000003");
const INCIDENT: ObjectID = new ObjectID("6600cccc-0000-4000-8000-000000000004");
const FIRST_RULE: ObjectID = new ObjectID(
  "6600cccc-0000-4000-8000-000000000005",
);

const INCIDENT_CREATED_AT: Date = new Date("2026-11-10T09:30:00.000Z");

// The page start each paging step was handed, in order.
let seenByFirstRule: Array<OnCallPageStartMoment | null>;
let seenByMoveOn: Array<OnCallPageStartMoment | null>;
let firstLevelIsEmpty: boolean;

beforeEach(() => {
  seenByFirstRule = [];
  seenByMoveOn = [];
  firstLevelIsEmpty = false;

  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });

  // No policy link: the run's feed entry is not what these are about.
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue(null as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
    .mockImplementation((async () => {
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.id = FIRST_RULE;
      return rule;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
    .mockImplementation((async () => {
      // What a notification the rule writes now would be told.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
      seenByFirstRule.push(OnCallPageTiming.getPageStart());
      return { movesOnAtOnce: firstLevelIsEmpty };
    }) as never);

  jest
    .spyOn(OnCallEscalationAdvance, "moveOnAtOnce")
    .mockImplementation((async () => {
      seenByMoveOn.push(OnCallPageTiming.getPageStart());
      return null;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function runOfIncident(
  overrides: Partial<OnCallDutyPolicyExecutionLog> = {},
): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = RUN;
  run.projectId = PROJECT;
  run.onCallDutyPolicyId = POLICY;
  run.triggeredByIncidentId = INCIDENT;
  run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  run.status = OnCallDutyPolicyStatus.Scheduled;
  Object.assign(run, overrides);

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

describe("a run pages its first rule inside its page's start", () => {
  test("started as its incident was created: the page starts at the incident's creation - the trigger", async () => {
    await OnCallPageTiming.runAsRecordIsCreated(
      { recordCreatedAt: INCIDENT_CREATED_AT },
      async (): Promise<void> => {
        await created(runOfIncident());
      },
    );

    expect(seenByFirstRule).toEqual([
      {
        startedAt: INCIDENT_CREATED_AT,
        start: OnCallPageStart.RecordCreated,
      },
    ]);
  });

  test("started later - a person ran the policy, a rule now matches: the page starts as it pages", async () => {
    const before: number = Date.now();

    await created(runOfIncident());

    const after: number = Date.now();

    expect(seenByFirstRule).toHaveLength(1);
    expect(seenByFirstRule[0]!.start).toBe(OnCallPageStart.PageStarted);
    expect(seenByFirstRule[0]!.startedAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(seenByFirstRule[0]!.startedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("a first level with nobody on it: the level it moves on to at once is due at the same start", async () => {
    firstLevelIsEmpty = true;

    await OnCallPageTiming.runAsRecordIsCreated(
      { recordCreatedAt: INCIDENT_CREATED_AT },
      async (): Promise<void> => {
        await created(runOfIncident());
      },
    );

    expect(seenByMoveOn).toHaveLength(1);
    expect(seenByMoveOn[0]).toEqual(seenByFirstRule[0]);
    expect(seenByMoveOn[0]!.start).toBe(OnCallPageStart.RecordCreated);
  });

  test("a run that waits to page pages nobody as it is created", async () => {
    await OnCallPageTiming.runAsRecordIsCreated(
      { recordCreatedAt: INCIDENT_CREATED_AT },
      async (): Promise<void> => {
        await created(
          runOfIncident({ status: OnCallDutyPolicyStatus.Waiting }),
        );
      },
    );

    expect(seenByFirstRule).toEqual([]);
  });

  test("a run that waited starts its page when its wait is over, not at the incident's creation", async () => {
    // The worker's claim moves the run from Waiting to Started.
    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as {
          getRepository: () => unknown;
        },
        "getRepository",
      )
      .mockReturnValue({
        update: async (): Promise<{ affected: number }> => {
          return { affected: 1 };
        },
      } as never);

    const before: number = Date.now();

    const started: boolean =
      await OnCallDutyPolicyExecutionLogService.startWaitingRun({
        run: runOfIncident({ status: OnCallDutyPolicyStatus.Waiting }),
        now: new Date(),
      });

    expect(started).toBe(true);
    expect(seenByFirstRule).toHaveLength(1);
    expect(seenByFirstRule[0]!.start).toBe(OnCallPageStart.PageStarted);
    expect(seenByFirstRule[0]!.startedAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });

  test("after the first rule, nothing the run does later is told a start", async () => {
    await created(runOfIncident());

    expect(OnCallPageTiming.getPageStart()).toBeNull();
  });
});

/*
 * The source's own shape, for the paths these do not drive: a call that
 * starts a page must be made inside a page's start, and a record's on-call
 * fan-out inside its creation, or their notifications go untimed - or are
 * timed from the wrong moment.
 */
describe("every way a page starts is timed from its start (guard)", () => {
  const SERVICES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Services",
  );

  function sourceOf(fileName: string): string {
    return fs.readFileSync(path.join(SERVICES_DIR, fileName), "utf8");
  }

  /*
   * Each place `call` is made in `source`, with the 400 characters before
   * it - enough to see the callback it is made in.
   */
  function contextsOf(source: string, call: string): Array<string> {
    const contexts: Array<string> = [];
    let index: number = source.indexOf(call);

    while (index !== -1) {
      contexts.push(source.substring(Math.max(0, index - 400), index));
      index = source.indexOf(call, index + call.length);
    }

    return contexts;
  }

  test.each([
    "OnCallDutyPolicyEscalationRuleService.startRuleExecution(",
    "OnCallDutyPolicyEscalationRuleService.startDirectPage(",
    "OnCallEscalationAdvance.moveOnAtOnce(",
  ])(
    "OnCallDutyPolicyExecutionLogService makes every %s inside a page's start",
    (call: string) => {
      const contexts: Array<string> = contextsOf(
        sourceOf("OnCallDutyPolicyExecutionLogService.ts"),
        call,
      );

      expect(contexts.length).toBeGreaterThan(0);

      for (const context of contexts) {
        expect(context).toContain("OnCallPageTiming.runInPageStart(");
      }
    },
  );

  test.each([
    ["IncidentService.ts", "this.executeOnCallDutyPoliciesAsync("],
    ["AlertService.ts", "this.executeAlertOnCallDutyPoliciesAsync("],
    [
      "IncidentEpisodeService.ts",
      "this.executeEpisodeOnCallDutyPoliciesAsync(",
    ],
    ["AlertEpisodeService.ts", "this.executeEpisodeOnCallDutyPoliciesAsync("],
  ])(
    "%s runs its on-call fan-out as the record is created",
    (fileName: string, call: string) => {
      const contexts: Array<string> = contextsOf(sourceOf(fileName), call);

      expect(contexts).toHaveLength(1);
      expect(contexts[0]!).toContain("OnCallPageTiming.runAsRecordIsCreated(");
      expect(contexts[0]!).toContain("recordCreatedAt: createdItem.createdAt");
    },
  );

  test.each([
    ["MonitorIncident.ts", "return IncidentService.create("],
    ["MonitorAlert.ts", "return AlertService.create("],
  ])(
    "%s creates the record its monitor's data tripped as that data's trigger",
    (fileName: string, call: string) => {
      const source: string = fs.readFileSync(
        path.join(SERVICES_DIR, "..", "Utils", "Monitor", fileName),
        "utf8",
      );
      const contexts: Array<string> = contextsOf(source, call);

      expect(contexts).toHaveLength(1);
      expect(contexts[0]!).toContain("OnCallPageTiming.runAsMonitorTriggered(");
      expect(contexts[0]!).toContain(
        "OnCallPageTiming.getMonitorDataReceivedAt(",
      );
      // And nowhere is it created any other way.
      expect(source.split(call.replace("return ", "")).length).toBe(2);
    },
  );

  test.each([
    ["IncidentService.ts", "NotificationTriggerType.Incident"],
    ["AlertService.ts", "NotificationTriggerType.Alert"],
    ["IncidentEpisodeService.ts", "NotificationTriggerType.IncidentEpisode"],
    ["AlertEpisodeService.ts", "NotificationTriggerType.AlertEpisode"],
  ])(
    "%s counts every record it creates as a trigger",
    (fileName: string, type: string) => {
      const source: string = sourceOf(fileName);
      const onCreateSuccess: number = source.indexOf(
        "protected override async onCreateSuccess(",
      );

      expect(onCreateSuccess).toBeGreaterThan(-1);

      const recordTrigger: number = source.indexOf(
        "NotificationDeliveryMetrics.recordTrigger(",
        onCreateSuccess,
      );

      expect(recordTrigger).toBeGreaterThan(onCreateSuccess);
      expect(source.substring(recordTrigger, recordTrigger + 200)).toContain(
        type,
      );
      // Counted once: a record is one trigger.
      expect(
        source.split("NotificationDeliveryMetrics.recordTrigger("),
      ).toHaveLength(2);
    },
  );
});
