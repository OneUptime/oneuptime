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
import ts from "typescript";

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
 * A record service's on-call fan-out, read through the TypeScript AST: the
 * calls in it that page - the record's on-call policies, and those its
 * on-call rules page as observers - each with whether it is made inside an
 * OnCallPageTiming.runAsRecordIsCreated whose start is the record's
 * creation, however deep in that callback it sits. A comment naming the
 * wrapper does not count, nor does a wrapper whose start is any other
 * moment, nor a call made as the wrapper's argument (it would run before
 * the wrapper does).
 */
const PAGING_CALLS: Array<string> = [
  "OnCallDutyPolicyService.executePolicy",
  "OnCallObserverPaging.pagePolicies",
];

const RECORD_CREATION_WRAPPER: string = "OnCallPageTiming.runAsRecordIsCreated";

interface PagingCall {
  callee: string;
  line: number;
  isInsideCreation: boolean;
}

interface FanOutReading {
  isFound: boolean;
  pagingCalls: Array<PagingCall>;
  // Paging calls made anywhere in the service but its fan-out.
  pagingCallsOutsideFanOut: Array<PagingCall>;
  // The method each call to the fan-out is made from.
  calledFrom: Array<string>;
}

function readFanOut(
  fileName: string,
  source: string,
  fanOut: string,
): FanOutReading {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const textOf: (node: ts.Node) => string = (node: ts.Node): string => {
    return node.getText(sourceFile);
  };

  const methodOf: (node: ts.Node) => ts.MethodDeclaration | null = (
    node: ts.Node,
  ): ts.MethodDeclaration | null => {
    let current: ts.Node | undefined = node.parent;

    while (current) {
      if (ts.isMethodDeclaration(current)) {
        return current;
      }
      current = current.parent;
    }

    return null;
  };

  const isRecordCreationStart: (node: ts.Node | undefined) => boolean = (
    node: ts.Node | undefined,
  ): boolean => {
    return Boolean(
      node &&
        ts.isObjectLiteralExpression(node) &&
        node.properties.some((property: ts.ObjectLiteralElementLike) => {
          return (
            ts.isPropertyAssignment(property) &&
            textOf(property.name) === "recordCreatedAt" &&
            textOf(property.initializer) === "createdItem.createdAt"
          );
        }),
    );
  };

  // Inside the callback of a wrapper that starts at the record's creation.
  const isInsideCreation: (call: ts.CallExpression) => boolean = (
    call: ts.CallExpression,
  ): boolean => {
    let child: ts.Node = call;
    let current: ts.Node | undefined = call.parent;

    while (current && !ts.isMethodDeclaration(current)) {
      if (
        ts.isCallExpression(current) &&
        textOf(current.expression) === RECORD_CREATION_WRAPPER &&
        isRecordCreationStart(current.arguments[0]) &&
        current.arguments[1] === child &&
        (ts.isArrowFunction(child) || ts.isFunctionExpression(child))
      ) {
        return true;
      }

      child = current;
      current = current.parent;
    }

    return false;
  };

  const reading: FanOutReading = {
    isFound: false,
    pagingCalls: [],
    pagingCallsOutsideFanOut: [],
    calledFrom: [],
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && textOf(node.name) === fanOut) {
      reading.isFound = true;
    }

    if (ts.isCallExpression(node)) {
      const callee: string = textOf(node.expression);
      const method: ts.MethodDeclaration | null = methodOf(node);
      const methodName: string = method
        ? textOf(method.name)
        : "(outside a method)";

      if (PAGING_CALLS.includes(callee)) {
        const call: PagingCall = {
          callee: callee,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          isInsideCreation: isInsideCreation(node),
        };

        if (methodName === fanOut) {
          reading.pagingCalls.push(call);
        } else {
          reading.pagingCallsOutsideFanOut.push(call);
        }
      }

      if (callee === `this.${fanOut}`) {
        reading.calledFrom.push(methodName);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return reading;
}

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
    ["IncidentService.ts", "executeOnCallDutyPoliciesAsync"],
    ["AlertService.ts", "executeAlertOnCallDutyPoliciesAsync"],
    ["IncidentEpisodeService.ts", "executeEpisodeOnCallDutyPoliciesAsync"],
    ["AlertEpisodeService.ts", "executeEpisodeOnCallDutyPoliciesAsync"],
  ])(
    "%s runs its on-call fan-out as the record is created",
    (fileName: string, fanOut: string) => {
      const reading: FanOutReading = readFanOut(
        fileName,
        sourceOf(fileName),
        fanOut,
      );

      expect(reading.isFound).toBe(true);

      // It pages both ways: the record's policies, and its observers'.
      for (const callee of PAGING_CALLS) {
        expect(
          reading.pagingCalls.filter((call: PagingCall) => {
            return call.callee === callee;
          }).length,
        ).toBeGreaterThan(0);
      }

      // Every one of them inside the record's creation.
      expect(
        reading.pagingCalls.filter((call: PagingCall) => {
          return !call.isInsideCreation;
        }),
      ).toEqual([]);

      // Nothing else in the service pages.
      expect(reading.pagingCallsOutsideFanOut).toEqual([]);

      /*
       * Called once, from onCreateSuccess - as a step of its own, which
       * CreateStepsDecideOnStartingStageGuard reads: the fan-out wraps its
       * own paging, after deciding the record's starting stage pages.
       */
      expect(reading.calledFrom).toEqual(["onCreateSuccess"]);
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

/*
 * The guard's own reading, on services written for it: the shape the four
 * services have passes, and each shape that would page outside the
 * record's creation - or that once did - is found.
 */
describe("the fan-out guard's reading", () => {
  const WRAPPED_FAN_OUT: string = [
    "    await OnCallPageTiming.runAsRecordIsCreated(",
    "      { recordCreatedAt: createdItem.createdAt },",
    "      async (): Promise<void> => {",
    "        await Promise.allSettled(",
    "          policies.map((policy: OnCallDutyPolicy) => {",
    "            return OnCallDutyPolicyService.executePolicy(policy.id, {});",
    "          }),",
    "        );",
    "        await OnCallObserverPaging.pagePolicies({ policyIds: [] });",
    "      },",
    "    );",
  ].join("\n");

  const UNWRAPPED_FAN_OUT: string = [
    "    await Promise.allSettled(",
    "      policies.map((policy: OnCallDutyPolicy) => {",
    "        return OnCallDutyPolicyService.executePolicy(policy.id, {});",
    "      }),",
    "    );",
    "    await OnCallObserverPaging.pagePolicies({ policyIds: [] });",
  ].join("\n");

  function serviceWith(settings: {
    onCreateSuccess?: string;
    fanOutBody: string;
    otherMethods?: string;
  }): string {
    return [
      "class Service {",
      "  protected override async onCreateSuccess(): Promise<void> {",
      settings.onCreateSuccess ||
        "    await this.fanOut(createdItem, startingStage);",
      "  }",
      "",
      "  private async fanOut(",
      "    createdItem: Model,",
      "    startingStage: StartingStage,",
      "  ): Promise<void> {",
      "    if (!StartingStageUtil.pagesOnCall(startingStage)) {",
      "      return;",
      "    }",
      "",
      settings.fanOutBody,
      "  }",
      settings.otherMethods || "",
      "}",
    ].join("\n");
  }

  function outsideCreation(reading: FanOutReading): Array<string> {
    return reading.pagingCalls
      .filter((call: PagingCall) => {
        return !call.isInsideCreation;
      })
      .map((call: PagingCall) => {
        return call.callee;
      });
  }

  test("the services' shape: both kinds of paging inside the record's creation, the fan-out called from onCreateSuccess", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({ fanOutBody: WRAPPED_FAN_OUT }),
      "fanOut",
    );

    expect(reading.isFound).toBe(true);
    expect(
      reading.pagingCalls.map((call: PagingCall) => {
        return call.callee;
      }),
    ).toEqual(PAGING_CALLS);
    expect(outsideCreation(reading)).toEqual([]);
    expect(reading.pagingCallsOutsideFanOut).toEqual([]);
    expect(reading.calledFrom).toEqual(["onCreateSuccess"]);
  });

  test("the shape before: onCreateSuccess wrapped the fan-out, which paged unwrapped - found, as the wrapping sat outside the fan-out", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        onCreateSuccess: [
          "    await OnCallPageTiming.runAsRecordIsCreated(",
          "      { recordCreatedAt: createdItem.createdAt },",
          "      (): Promise<void> => {",
          "        return this.fanOut(createdItem, startingStage);",
          "      },",
          "    );",
        ].join("\n"),
        fanOutBody: UNWRAPPED_FAN_OUT,
      }),
      "fanOut",
    );

    expect(outsideCreation(reading)).toEqual(PAGING_CALLS);
    expect(reading.calledFrom).toEqual(["onCreateSuccess"]);
  });

  test("observers paged after the wrapper, not in it: only that call is found, on its line", () => {
    const source: string = serviceWith({
      fanOutBody: [
        "    await OnCallPageTiming.runAsRecordIsCreated(",
        "      { recordCreatedAt: createdItem.createdAt },",
        "      async (): Promise<void> => {",
        "        await OnCallDutyPolicyService.executePolicy(policyId, {});",
        "      },",
        "    );",
        "    await OnCallObserverPaging.pagePolicies({ policyIds: [] });",
      ].join("\n"),
    });
    const reading: FanOutReading = readFanOut("Service.ts", source, "fanOut");

    expect(outsideCreation(reading)).toEqual([
      "OnCallObserverPaging.pagePolicies",
    ]);

    const found: PagingCall = reading.pagingCalls.find((call: PagingCall) => {
      return !call.isInsideCreation;
    })!;

    expect(source.split("\n")[found.line - 1]).toContain(
      "OnCallObserverPaging.pagePolicies(",
    );
  });

  test.each([
    ["the moment the fan-out runs", "OneUptimeDate.getCurrentDate()"],
    ["another record's creation", "otherItem.createdAt"],
    ["the record's last change", "createdItem.updatedAt"],
  ])(
    "a wrapper that starts at %s is not the record's creation: both found",
    (_moment: string, start: string) => {
      const reading: FanOutReading = readFanOut(
        "Service.ts",
        serviceWith({
          fanOutBody: WRAPPED_FAN_OUT.replace("createdItem.createdAt", start),
        }),
        "fanOut",
      );

      expect(outsideCreation(reading)).toEqual(PAGING_CALLS);
    },
  );

  test("a wrapper with no start at all: both found", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: WRAPPED_FAN_OUT.replace(
          "{ recordCreatedAt: createdItem.createdAt }",
          "{}",
        ),
      }),
      "fanOut",
    );

    expect(outsideCreation(reading)).toEqual(PAGING_CALLS);
  });

  test("another wrapper - a page's start, not the record's creation: both found", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: WRAPPED_FAN_OUT.replace(
          "OnCallPageTiming.runAsRecordIsCreated(",
          "OnCallPageTiming.runInPageStart(",
        ),
      }),
      "fanOut",
    );

    expect(outsideCreation(reading)).toEqual(PAGING_CALLS);
  });

  test("a paging call made as the wrapper's argument runs before the wrapper does: found", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: [
          "    await OnCallPageTiming.runAsRecordIsCreated(",
          "      { recordCreatedAt: createdItem.createdAt },",
          "      OnCallObserverPaging.pagePolicies({ policyIds: [] }) as never,",
          "    );",
        ].join("\n"),
      }),
      "fanOut",
    );

    expect(outsideCreation(reading)).toEqual([
      "OnCallObserverPaging.pagePolicies",
    ]);
  });

  test("a comment naming the wrapper, close above the calls, does not count: both found", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: [
          "    // OnCallPageTiming.runAsRecordIsCreated(",
          "    //   { recordCreatedAt: createdItem.createdAt }, ...)",
          UNWRAPPED_FAN_OUT,
        ].join("\n"),
      }),
      "fanOut",
    );

    expect(outsideCreation(reading)).toEqual(PAGING_CALLS);
  });

  test("a callback that returns the paging directly, or pages from a function expression, is inside", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: [
          "    await OnCallPageTiming.runAsRecordIsCreated(",
          "      { recordCreatedAt: createdItem.createdAt },",
          "      (): Promise<void> => OnCallDutyPolicyService.executePolicy(policyId, {}),",
          "    );",
          "    await OnCallPageTiming.runAsRecordIsCreated(",
          "      { recordCreatedAt: createdItem.createdAt },",
          "      async function (): Promise<void> {",
          "        for (const id of ids) {",
          "          if (id) {",
          "            await OnCallObserverPaging.pagePolicies({ policyIds: [id] });",
          "          }",
          "        }",
          "      },",
          "    );",
        ].join("\n"),
      }),
      "fanOut",
    );

    expect(reading.pagingCalls).toHaveLength(2);
    expect(outsideCreation(reading)).toEqual([]);
  });

  test("paging anywhere else in the service is found, wrapped or not", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: WRAPPED_FAN_OUT,
        otherMethods: [
          "  private async pageAgain(createdItem: Model): Promise<void> {",
          "    await OnCallPageTiming.runAsRecordIsCreated(",
          "      { recordCreatedAt: createdItem.createdAt },",
          "      async (): Promise<void> => {",
          "        await OnCallDutyPolicyService.executePolicy(policyId, {});",
          "      },",
          "    );",
          "  }",
        ].join("\n"),
      }),
      "fanOut",
    );

    expect(outsideCreation(reading)).toEqual([]);
    expect(
      reading.pagingCallsOutsideFanOut.map((call: PagingCall) => {
        return call.callee;
      }),
    ).toEqual(["OnCallDutyPolicyService.executePolicy"]);
  });

  test("a fan-out also called from another hook is found", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({
        fanOutBody: WRAPPED_FAN_OUT,
        otherMethods: [
          "  protected override async onUpdateSuccess(): Promise<void> {",
          "    await this.fanOut(updatedItem, startingStage);",
          "  }",
        ].join("\n"),
      }),
      "fanOut",
    );

    expect(reading.calledFrom).toEqual(["onCreateSuccess", "onUpdateSuccess"]);
  });

  test("a fan-out the service does not have is not found, and pages nothing", () => {
    const reading: FanOutReading = readFanOut(
      "Service.ts",
      serviceWith({ fanOutBody: WRAPPED_FAN_OUT }),
      "renamedFanOut",
    );

    expect(reading.isFound).toBe(false);
    expect(reading.pagingCalls).toEqual([]);
    expect(reading.calledFrom).toEqual([]);
    // Its paging is then paging outside the fan-out the guard names.
    expect(reading.pagingCallsOutsideFanOut).toHaveLength(2);
  });
});
