import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertIncidentRuleEngineService from "../../../Server/Services/AlertIncidentRuleEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import AiFirstResponder from "../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import AIAlertInvestigationRunner from "../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import IncidentFollowUpCheck from "../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AlertOnCallRulesOnOwnerChange from "../../../Server/Utils/Alert/AlertOnCallRulesOnOwnerChange";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import VideoCallRuleExecutor from "../../../Server/Utils/VideoCall/VideoCallRuleExecutor";
import ChannelMembersNotAddedNotice from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import WorkspaceCreatedMessageFirst from "../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import { WorkspaceRecord } from "../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import WorkspaceRuleOwnersOnCreate from "../../../Server/Utils/Workspace/WorkspaceRuleOwnersOnCreate";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import { StartingStage } from "../../../Utils/StartingStage";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

jest.mock("../../../Server/Utils/Logger");

/*
 * A NEW ALERT'S OR INCIDENT'S CHANNELS OPEN, AND ITS CREATED MESSAGE IS
 * POSTED, ONCE ITS OWNERS AND LABELS ARE IN (#11146) - AND ITS FEED STARTS
 * WITH HOW IT WAS CREATED (#10911).
 *
 * Each service's real create hook (onCreateSuccess) is driven here with its
 * other steps stood in, every step logged in the order it ran:
 *
 *   - its owners (handed over with the create, carried over from the alerts
 *     an incident is declared from, its owner rules') and its label rules'
 *     labels come before its channels are opened and its Created message is
 *     posted, so the notification rules that ask who owns it or how it is
 *     labelled match it; the owners added from outside the chain are waited
 *     for in between (WorkspaceRuleOwnersOnCreate);
 *   - every other message about it is held from the start of the chain
 *     until right after the Created message and the note under it
 *     (WorkspaceCreatedMessageFirst), and let go even when the chain stops
 *     short of it;
 *   - its pages still come after all of that;
 *   - the Created entry is filed when its feed starts, and an incident's
 *     "Declared from N alerts" a millisecond before it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-000000000101",
);
const RECORD_ID: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-000000000102",
);
const ALERT_ID: ObjectID = new ObjectID("11146000-0000-4000-8000-000000000103");
const PLATFORM_TEAM: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-000000000104",
);
const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-000000000105",
);
const FEED_STARTS_AT: Date = new Date("2026-11-24T11:30:00.000Z");

// Every stood-in step, in the order they ran.
let steps: Array<string> = [];

// Whether the record's messages were held as each step ran.
let heldAt: Map<string, boolean> = new Map<string, boolean>();

let record: WorkspaceRecord = {};

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function hookOf(service: unknown, name: string): HookFunction {
  const hooks: Record<string, HookFunction> = service as Record<
    string,
    HookFunction
  >;
  return hooks[name]!.bind(service);
}

// Stands a step in: it is logged, answers `result`, and may end the chain.
function step(
  target: unknown,
  method: string,
  name: string,
  options?: {
    result?: unknown;
    fail?: boolean;
    done?: () => void;
    run?: () => Promise<void>;
  },
): SpyInstance<(...args: Array<unknown>) => Promise<unknown>> {
  return jest
    .spyOn(
      target as Record<string, (...args: Array<unknown>) => Promise<unknown>>,
      method,
    )
    .mockImplementation((async (): Promise<unknown> => {
      steps.push(name);
      heldAt.set(name, WorkspaceCreatedMessageFirst.isHeld(record));

      if (options?.run) {
        await options.run();
      }

      if (options?.done) {
        options.done();
      }

      if (options?.fail) {
        throw new Error(`${name} failed`);
      }

      return options?.result;
    }) as never);
}

// A promise for the chain's last step, and the function that ends it.
function chainEnd(): { ended: Promise<void>; end: () => void } {
  let end: () => void = () => {};
  const ended: Promise<void> = new Promise<void>((resolve: () => void) => {
    end = resolve;
  });
  return { ended, end };
}

// Waits for the chain, or two seconds: a chain that never ends fails below.
async function waitFor(ended: Promise<void>): Promise<void> {
  await Promise.race([
    ended,
    new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 2000);
    }),
  ]);
}

// Logs the held messages being let go, and lets them go.
function logRelease(): void {
  const postHeld: (record: WorkspaceRecord) => Promise<void> =
    WorkspaceCreatedMessageFirst.postHeld.bind(WorkspaceCreatedMessageFirst);

  jest
    .spyOn(WorkspaceCreatedMessageFirst, "postHeld")
    .mockImplementation(async (released: WorkspaceRecord): Promise<void> => {
      steps.push("held messages");
      await postHeld(released);
    });
}

beforeEach(() => {
  steps = [];
  heldAt = new Map<string, boolean>();
  record = {};

  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);

  logRelease();
});

afterEach(async () => {
  await WorkspaceCreatedMessageFirst.postHeld(record);
  jest.restoreAllMocks();
});

describe("an alert's create chain", () => {
  let waitForOwners: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;
  let alertCreated: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;

  function standIn(options: { createdResolved?: boolean } = {}): Promise<void> {
    const { ended, end } = chainEnd();

    record = { alertId: RECORD_ID };

    step(AlertPrivacyRuleEngineService, "applyRulesToAlert", "privacy");
    step(AlertService, "handleAlertStateChangeAsync", "first state");
    step(AlertService, "addOwners", "owners picked");
    step(AlertOwnerRuleEngineService, "applyRulesToAlert", "owner rules");
    step(AlertLabelRuleEngineService, "applyRulesToAlert", "label rules");
    waitForOwners = step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
    );
    step(AlertService, "handleAlertWorkspaceOperationsAsync", "channels", {
      result: [],
    });
    alertCreated = step(AlertService, "createAlertFeedAsync", "Alert Created");
    step(ChannelMembersNotAddedNotice, "noteAll", "note");
    step(VideoCallRuleExecutor, "startCallsForAlert", "video calls");
    step(
      AlertOnCallRulesOnOwnerChange,
      "waitForOwnersOfCreate",
      "on-call owners",
    );
    step(AlertOnCallRuleEngineService, "applyRulesToAlert", "on-call rules");
    step(AiFirstResponder, "onRecordCreated", "first responder");
    step(RunbookRuleEngineService, "applyRulesToAlert", "runbooks");
    step(AlertService, "executeAlertOnCallDutyPoliciesAsync", "paging");
    step(AlertIncidentRuleEngineService, "applyRulesToAlert", "incident rules");
    step(AlertGroupingEngineService, "processAlert", "grouping");
    step(AlertService, "refreshReminderSchedule", "reminders");
    // The last step an alert created resolved runs: the rest answer a live problem.
    step(AIAlertInvestigationRunner, "investigateNewAlert", "ai", {
      result: false,
      ...(options.createdResolved ? { done: end } : {}),
    });
    step(AutoRemediationRuleEngineService, "onAlertCreated", "remediation");
    step(IncidentFollowUpCheck, "onAlertOpened", "follow-up", { done: end });

    return ended;
  }

  function createBy(): CreateBy<Alert> {
    const alert: Alert = new Alert();
    alert.id = RECORD_ID;
    alert.projectId = PROJECT_ID;

    return {
      data: alert,
      props: { isRoot: true },
      miscDataProps: { ownerTeams: [PLATFORM_TEAM] },
    };
  }

  async function create(
    create: CreateBy<Alert> = createBy(),
    carryForward: Record<string, unknown> = {
      startingStage: StartingStage.Open,
      feedStartsAt: FEED_STARTS_AT,
    },
  ): Promise<void> {
    const alert: Alert = new Alert();
    alert.id = RECORD_ID;
    alert.projectId = PROJECT_ID;
    alert.currentAlertStateId = ObjectID.generate();

    const onCreate: OnCreate<Alert> = {
      createBy: create,
      carryForward: carryForward,
    };

    await hookOf(AlertService, "onCreateSuccess")(onCreate, alert);
  }

  test("REGRESSION: its owners and labels are in before its channels open and Alert Created is posted, and its pages come after", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(steps).toEqual([
      "privacy",
      "first state",
      "owners picked",
      "owner rules",
      "label rules",
      "owners waited for",
      "channels",
      "Alert Created",
      "note",
      "held messages",
      "video calls",
      "on-call owners",
      "on-call rules",
      "first responder",
      "runbooks",
      "paging",
      "incident rules",
      "grouping",
      "reminders",
      "ai",
      "remediation",
      "follow-up",
    ]);
  });

  test("its other messages are held from the start of the chain until right after Alert Created and the note", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    for (const held of [
      "privacy",
      "first state",
      "owners picked",
      "owner rules",
      "label rules",
      "owners waited for",
      "channels",
      "Alert Created",
      "note",
    ]) {
      expect({ step: held, held: heldAt.get(held) }).toEqual({
        step: held,
        held: true,
      });
    }

    for (const free of ["video calls", "on-call rules", "paging"]) {
      expect({ step: free, held: heldAt.get(free) }).toEqual({
        step: free,
        held: false,
      });
    }

    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });

  test("the owners added outside the chain are waited for, for this alert, as an alert, with its create", async () => {
    const create_: CreateBy<Alert> = createBy();
    const ended: Promise<void> = standIn();
    await create(create_);
    await waitFor(ended);

    expect(waitForOwners).toHaveBeenCalledTimes(1);
    expect(waitForOwners.mock.calls[0]![0]).toEqual({
      createBy: create_,
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Alert,
      recordId: RECORD_ID,
    });
    expect(
      (waitForOwners.mock.calls[0]![0] as { createBy: unknown }).createBy,
    ).toBe(create_);
  });

  test("Alert Created is filed when the alert's feed starts, as onBeforeCreate handed it over", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(alertCreated.mock.calls[0]).toEqual([RECORD_ID, FEED_STARTS_AT]);
  });

  test("without a feed start handed over, Alert Created is filed as it is written", async () => {
    const ended: Promise<void> = standIn();
    await create(createBy(), { startingStage: StartingStage.Open });
    await waitFor(ended);

    expect(alertCreated.mock.calls[0]).toEqual([RECORD_ID, undefined]);
  });

  test("an alert created resolved opens no channel, and its Alert Created still waits for its owners and labels", async () => {
    const ended: Promise<void> = standIn({ createdResolved: true });
    await create(createBy(), {
      startingStage: StartingStage.Resolved,
      feedStartsAt: FEED_STARTS_AT,
    });
    await waitFor(ended);

    expect(steps).not.toContain("channels");
    expect(steps.indexOf("label rules")).toBeLessThan(
      steps.indexOf("Alert Created"),
    );
    expect(steps.indexOf("owners waited for")).toBeLessThan(
      steps.indexOf("Alert Created"),
    );
    expect(steps.indexOf("held messages")).toBe(
      steps.indexOf("Alert Created") + 2,
    );
  });

  test("a chain that stops short of Alert Created still lets the held messages go", async () => {
    standIn();
    step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
      { fail: true },
    );

    await create();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(steps).not.toContain("Alert Created");
    expect(steps).toContain("held messages");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });
});

describe("an incident's create chain", () => {
  let waitForOwners: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;
  let incidentCreated: SpyInstance<
    (...args: Array<unknown>) => Promise<unknown>
  >;
  let declaredFrom: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;
  let finishLinking: () => void = (): void => {
    // replaced while linking waits
  };

  function standIn(options: { slowLinks?: boolean } = {}): Promise<void> {
    const { ended, end } = chainEnd();

    record = { incidentId: RECORD_ID };

    const incident: Incident = new Incident();
    incident.id = RECORD_ID;
    incident.projectId = PROJECT_ID;
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    step(IncidentPrivacyRuleEngineService, "applyRulesToIncident", "privacy");
    declaredFrom = step(
      IncidentAlertService,
      "createDeclaredFromAlertsFeedItem",
      "declared from",
    );
    step(IncidentService, "handleIncidentStateChangeAsync", "first state");
    step(IncidentAlertService, "copyAlertOwnersToIncident", "alert owners");
    step(IncidentService, "addOwners", "owners picked");
    step(IncidentOwnerRuleEngineService, "applyRulesToIncident", "owner rules");
    step(IncidentLabelRuleEngineService, "applyRulesToIncident", "label rules");
    waitForOwners = step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
    );
    step(
      IncidentService,
      "handleIncidentWorkspaceOperationsAsync",
      "channels",
      {
        result: [],
      },
    );
    incidentCreated = step(
      IncidentService,
      "createIncidentFeedAsync",
      "Incident Created",
    );
    step(ChannelMembersNotAddedNotice, "noteAll", "note");
    step(VideoCallRuleExecutor, "startCallsForIncident", "video calls");
    step(IncidentService, "handleMonitorStatusChangeAsync", "monitor status");
    step(
      IncidentService,
      "disableActiveMonitoringIfManualIncident",
      "pause monitoring",
    );
    step(
      IncidentOnCallRuleEngineService,
      "applyRulesToIncident",
      "on-call rules",
    );
    step(AiFirstResponder, "onRecordCreated", "first responder");
    step(RunbookRuleEngineService, "applyRulesToIncident", "runbooks");
    step(IncidentService, "executeOnCallDutyPoliciesAsync", "paging");
    step(IncidentGroupingEngineService, "processIncident", "grouping");
    step(IncidentSlaService, "createSlaForIncident", "sla");
    step(IncidentService, "refreshReminderSchedule", "reminders");
    step(AIIncidentInvestigationRunner, "investigateNewIncident", "ai", {
      result: false,
    });
    step(AutoRemediationRuleEngineService, "onIncidentCreated", "remediation", {
      done: end,
    });

    jest
      .spyOn(IncidentAlertService, "linkAlertsToIncident")
      .mockImplementation((async (): Promise<unknown> => {
        if (options.slowLinks) {
          await new Promise<void>((resolve: () => void) => {
            finishLinking = resolve;
          });
        }

        steps.push("alerts linked");
        return {
          linkedAlertIds: [ALERT_ID],
          alreadyLinkedAlertIds: [],
          failed: [],
        };
      }) as never);

    return ended;
  }

  function onCreate(
    startingStage: StartingStage = StartingStage.Open,
    feedStartsAt: Date | null = FEED_STARTS_AT,
  ): OnCreate<Incident> {
    const incident: Incident = new Incident();
    incident.id = RECORD_ID;
    incident.projectId = PROJECT_ID;

    return {
      createBy: {
        data: incident,
        props: { isRoot: true },
        miscDataProps: { ownerTeams: [PLATFORM_TEAM] },
      },
      carryForward: {
        startingStage: startingStage,
        alertIdsToLink: [ALERT_ID],
        acknowledgedAlertStateId: null,
        alertIdsToAcknowledge: [],
        declaredByAlertIncidentRuleName: null,
        carryOverAlertOwners: true,
        ...(feedStartsAt ? { feedStartsAt: feedStartsAt } : {}),
      },
    };
  }

  async function create(
    hookInput: OnCreate<Incident> = onCreate(),
  ): Promise<void> {
    const incident: Incident = new Incident();
    incident.id = RECORD_ID;
    incident.projectId = PROJECT_ID;
    incident.changeMonitorStatusToId = MONITOR_STATUS_ID;
    // When it was declared: its SLA starts then.
    incident.declaredAt = FEED_STARTS_AT;

    await hookOf(IncidentService, "onCreateSuccess")(hookInput, incident);
  }

  test("REGRESSION: what it was declared from first, its owners and labels before its channels and Incident Created, its pages after", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(
      steps.filter((name: string): boolean => {
        return name !== "alerts linked";
      }),
    ).toEqual([
      "privacy",
      "declared from",
      "first state",
      "alert owners",
      "owners picked",
      "owner rules",
      "label rules",
      "owners waited for",
      "channels",
      "Incident Created",
      "note",
      "held messages",
      "video calls",
      "monitor status",
      "pause monitoring",
      "on-call rules",
      "first responder",
      "runbooks",
      "paging",
      "grouping",
      "sla",
      "reminders",
      "ai",
      "remediation",
    ]);
  });

  test("its other messages are held from the start of the chain until right after Incident Created and the note", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    for (const held of [
      "privacy",
      "declared from",
      "first state",
      "alert owners",
      "owners picked",
      "owner rules",
      "label rules",
      "owners waited for",
      "channels",
      "Incident Created",
      "note",
    ]) {
      expect({ step: held, held: heldAt.get(held) }).toEqual({
        step: held,
        held: true,
      });
    }

    for (const free of ["video calls", "monitor status", "paging"]) {
      expect({ step: free, held: heldAt.get(free) }).toEqual({
        step: free,
        held: false,
      });
    }
  });

  test("the owners added outside the chain are waited for, for this incident, as an incident", async () => {
    const hookInput: OnCreate<Incident> = onCreate();
    const ended: Promise<void> = standIn();
    await create(hookInput);
    await waitFor(ended);

    expect(waitForOwners.mock.calls[0]![0]).toEqual({
      createBy: hookInput.createBy,
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Incident,
      recordId: RECORD_ID,
    });
  });

  test("REGRESSION (#10911): Declared from is filed a millisecond before the feed starts, Incident Created as it starts", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(
      (declaredFrom.mock.calls[0]![0] as { postedAt?: Date }).postedAt,
    ).toEqual(new Date("2026-11-24T11:29:59.999Z"));
    expect(incidentCreated.mock.calls[0]![2]).toEqual(FEED_STARTS_AT);
  });

  test("without a feed start handed over, both are filed as they are written", async () => {
    const ended: Promise<void> = standIn();
    await create(onCreate(StartingStage.Open, null));
    await waitFor(ended);

    expect(
      Object.keys(declaredFrom.mock.calls[0]![0] as Record<string, unknown>),
    ).not.toContain("postedAt");
    expect(incidentCreated.mock.calls[0]![2]).toBeUndefined();
  });

  test("declared open, its first state - and so its pages - do not wait for the alerts to be linked", async () => {
    const ended: Promise<void> = standIn({ slowLinks: true });
    const created: Promise<void> = create();

    await waitFor(ended);

    expect(steps).toContain("first state");
    expect(steps).toContain("paging");
    expect(steps).not.toContain("alerts linked");

    // The hook itself returns once they are linked: the page lists them.
    finishLinking();
    await created;

    expect(steps).toContain("alerts linked");
  });

  test("declared already acknowledged, its first state waits for the alerts to be linked: it carries over to them", async () => {
    const ended: Promise<void> = standIn({ slowLinks: true });
    const created: Promise<void> = create(onCreate(StartingStage.Acknowledged));

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(steps).toContain("declared from");
    expect(steps).not.toContain("first state");

    finishLinking();
    await waitFor(ended);
    await created;

    expect(steps.indexOf("alerts linked")).toBeLessThan(
      steps.indexOf("first state"),
    );
  });

  test("a chain that stops short of Incident Created still lets the held messages go", async () => {
    standIn();
    step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
      { fail: true },
    );

    await create();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(steps).not.toContain("Incident Created");
    expect(steps).toContain("held messages");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });
});

describe("when a record's feed starts", () => {
  test("an alert's is read in onBeforeCreate, before it takes its number - so before it is written", async () => {
    stubProjectDirectory({});

    const createdState: AlertState = new AlertState();
    createdState._id = ObjectID.generate().toString();
    jest
      .spyOn(AlertStateService, "findOneBy")
      .mockResolvedValue(createdState as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);

    const counter: SpyInstance<
      typeof ProjectService.incrementAndGetAlertCounter
    > = jest
      .spyOn(ProjectService, "incrementAndGetAlertCounter")
      .mockResolvedValue({ counter: 7, prefix: undefined } as never);

    let clock: number = FEED_STARTS_AT.getTime();
    const reads: SpyInstance<typeof OneUptimeDate.getCurrentDate> = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockImplementation((): Date => {
        clock += 1;
        return new Date(clock);
      });

    const result: OnCreate<Alert> = (await hookOf(
      AlertService,
      "onBeforeCreate",
    )({
      data: { title: "API latency is high" } as Alert,
      props: { tenantId: PROJECT_ID },
    })) as OnCreate<Alert>;

    const feedStartsAt: unknown = (
      result.carryForward as { feedStartsAt?: unknown }
    ).feedStartsAt;

    expect(feedStartsAt).toBeInstanceOf(Date);

    // The read that gave it came before the number was taken.
    const readIndex: number = reads.mock.results.findIndex(
      (read: { value: unknown }): boolean => {
        return (
          (read.value as Date).getTime() === (feedStartsAt as Date).getTime()
        );
      },
    );

    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(reads.mock.invocationCallOrder[readIndex]!).toBeLessThan(
      counter.mock.invocationCallOrder[0]!,
    );
  });
});
