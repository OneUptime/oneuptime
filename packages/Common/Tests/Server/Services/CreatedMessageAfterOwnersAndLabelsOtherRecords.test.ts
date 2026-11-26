import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "../../../Server/Services/MonitorOwnerRuleEngineService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../Server/Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../Server/Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import ScheduledMaintenanceLabelRuleEngineService from "../../../Server/Services/ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceOwnerRuleEngineService from "../../../Server/Services/ScheduledMaintenanceOwnerRuleEngineService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../Server/Utils/Notification/CreatedNotificationHold";
import MonitorFirstMeasured from "../../../Server/Utils/Monitor/MonitorFirstMeasured";
import OpenStackMaintenanceReach from "../../../Server/Utils/OpenStack/OpenStackMaintenanceReach";
import OpenStackMonitorDependencies from "../../../Server/Utils/OpenStack/OpenStackMonitorDependencies";
import OpenStackProjectNotices from "../../../Server/Utils/OpenStack/OpenStackProjectNotices";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import OwnerRuleAssignment from "../../../Server/Utils/Rules/OwnerRuleAssignment";
import ChannelMembersNotAddedNotice from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import WorkspaceCreatedMessageFirst from "../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import OnCallDutyPolicyWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import { WorkspaceRecord } from "../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import WorkspaceRuleOwnersOnCreate from "../../../Server/Utils/Workspace/WorkspaceRuleOwnersOnCreate";
import OneUptimeDate from "../../../Types/Date";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import { StartingStage } from "../../../Utils/StartingStage";

jest.mock("../../../Server/Utils/Logger");

/*
 * A NEW EPISODE'S, MAINTENANCE EVENT'S, MONITOR'S AND ON-CALL POLICY'S
 * CHANNELS OPEN, AND ITS CREATED MESSAGE IS POSTED, ONCE ITS OWNERS AND
 * LABELS ARE IN (#11188) - AS AN ALERT'S AND AN INCIDENT'S ARE (#11146,
 * CreatedMessageAfterOwnersAndLabels.test.ts).
 *
 * Incident episodes, alert episodes, scheduled maintenance events and
 * monitors opened their channels and posted their Created message first,
 * and only then added the owners picked on create, their owner rules' and
 * their label rules' labels: a notification rule asking who owns the record
 * or how it is labelled never posted its Created message. Each service's
 * real create hook (onCreateSuccess) is driven here with its other steps
 * stood in, every step logged in the order it ran:
 *
 *   - its first state, owners and labels come first, then a moment's wait
 *     for the owners added outside the chain (WorkspaceRuleOwnersOnCreate),
 *     then its channels and its Created message - filed when its feed
 *     started - and the note under it;
 *   - every other message about it is held from the start of the chain
 *     until right after the Created message (WorkspaceCreatedMessageFirst),
 *     and let go even when the chain stops short of it;
 *   - an episode's pages, and a maintenance event's runbooks and reminders,
 *     still come after all of that.
 *
 * An on-call policy ran its label and owner rules first already; what it
 * lacked was the hold, so the owners those rules added were posted ahead of
 * "On-Call Policy Created".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11188000-0000-4000-8000-000000000101",
);
const RECORD_ID: ObjectID = new ObjectID(
  "11188000-0000-4000-8000-000000000102",
);
const PLATFORM_TEAM: ObjectID = new ObjectID(
  "11188000-0000-4000-8000-000000000104",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "11188000-0000-4000-8000-000000000105",
);
const STATE_ID: ObjectID = new ObjectID("11188000-0000-4000-8000-000000000106");
const FEED_STARTS_AT: Date = new Date("2026-11-26T09:30:00.000Z");

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

async function turns(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 50);
  });
}

// Logs the held messages being let go, and lets them go.
function logRelease(): void {
  const postHeld: (released: WorkspaceRecord) => Promise<void> =
    WorkspaceCreatedMessageFirst.postHeld.bind(WorkspaceCreatedMessageFirst);

  jest
    .spyOn(WorkspaceCreatedMessageFirst, "postHeld")
    .mockImplementation(async (released: WorkspaceRecord): Promise<void> => {
      steps.push("held messages");
      await postHeld(released);
    });
}

// The steps that ran while the record's messages were held, and those after.
function expectHeldUntil(lastHeld: string): void {
  const until: number = steps.indexOf(lastHeld);

  expect(until).toBeGreaterThanOrEqual(0);

  for (const name of steps.slice(0, until + 1)) {
    expect({ step: name, held: heldAt.get(name) }).toEqual({
      step: name,
      held: true,
    });
  }

  for (const name of steps.slice(until + 1)) {
    if (name === "held messages") {
      continue;
    }

    expect({ step: name, held: heldAt.get(name) }).toEqual({
      step: name,
      held: false,
    });
  }
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

interface EpisodeKind {
  name: string;
  eventType: NotificationRuleEventType;
  service: typeof IncidentEpisodeService | typeof AlertEpisodeService;
  privacy: unknown;
  ownerRules: unknown;
  labelRules: unknown;
  onCallRules: unknown;
  members: unknown;
  addMembers: string;
  membersAddedEntry: string;
  idsToAddKey: string;
  stateColumn: string;
  recordOf: (id: ObjectID) => WorkspaceRecord;
  model: () => IncidentEpisode | AlertEpisode;
}

const EPISODE_KINDS: Array<EpisodeKind> = [
  {
    name: "an incident episode",
    eventType: NotificationRuleEventType.IncidentEpisode,
    service: IncidentEpisodeService,
    privacy: IncidentEpisodePrivacyRuleEngineService,
    ownerRules: IncidentEpisodeOwnerRuleEngineService,
    labelRules: IncidentEpisodeLabelRuleEngineService,
    onCallRules: IncidentEpisodeOnCallRuleEngineService,
    members: IncidentEpisodeMemberService,
    addMembers: "addIncidentsToNewEpisode",
    membersAddedEntry: "createIncidentsAddedFeedItem",
    idsToAddKey: "incidentIdsToAdd",
    stateColumn: "currentIncidentStateId",
    recordOf: (id: ObjectID): WorkspaceRecord => {
      return { incidentEpisodeId: id };
    },
    model: (): IncidentEpisode => {
      return new IncidentEpisode();
    },
  },
  {
    name: "an alert episode",
    eventType: NotificationRuleEventType.AlertEpisode,
    service: AlertEpisodeService,
    privacy: AlertEpisodePrivacyRuleEngineService,
    ownerRules: AlertEpisodeOwnerRuleEngineService,
    labelRules: AlertEpisodeLabelRuleEngineService,
    onCallRules: AlertEpisodeOnCallRuleEngineService,
    members: AlertEpisodeMemberService,
    addMembers: "addAlertsToNewEpisode",
    membersAddedEntry: "createAlertsAddedFeedItem",
    idsToAddKey: "alertIdsToAdd",
    stateColumn: "currentAlertStateId",
    recordOf: (id: ObjectID): WorkspaceRecord => {
      return { alertEpisodeId: id };
    },
    model: (): AlertEpisode => {
      return new AlertEpisode();
    },
  },
];

describe.each(EPISODE_KINDS)("$name's create chain", (kind: EpisodeKind) => {
  let waitForOwners: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;
  let episodeCreated: SpyInstance<
    (...args: Array<unknown>) => Promise<unknown>
  >;

  function standIn(): Promise<void> {
    const { ended, end } = chainEnd();

    record = kind.recordOf(RECORD_ID);

    step(kind.privacy, "applyRulesToEpisode", "privacy");
    // The members it is created with: added before the create answers.
    jest
      .spyOn(
        kind.members as Record<string, () => Promise<unknown>>,
        kind.addMembers,
      )
      .mockResolvedValue([MEMBER_ID] as never);
    step(kind.service, "changeEpisodeState", "first state");
    step(kind.members, kind.membersAddedEntry, "members added");
    step(OwnerRuleAssignment, "addOwnersPickedOnCreate", "owners picked");
    step(kind.ownerRules, "applyRulesToEpisode", "owner rules");
    step(kind.labelRules, "applyRulesToEpisode", "label rules");
    waitForOwners = step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
    );
    step(kind.service, "handleEpisodeWorkspaceOperationsAsync", "channels", {
      result: [],
    });
    episodeCreated = step(
      kind.service,
      "createEpisodeCreatedFeed",
      "Episode Created",
    );
    step(ChannelMembersNotAddedNotice, "noteAll", "note");
    step(kind.onCallRules, "applyRulesToEpisode", "on-call rules");
    step(kind.service, "executeEpisodeOnCallDutyPoliciesAsync", "paging", {
      done: end,
    });

    return ended;
  }

  function onCreate(
    carryForward: Record<string, unknown> = {
      startingStage: StartingStage.Open,
      [kind.idsToAddKey]: [MEMBER_ID],
      feedStartsAt: FEED_STARTS_AT,
    },
  ): OnCreate<IncidentEpisode | AlertEpisode> {
    const episode: IncidentEpisode | AlertEpisode = kind.model();
    episode.id = RECORD_ID;
    episode.projectId = PROJECT_ID;

    return {
      createBy: {
        data: episode,
        props: { isRoot: true },
        miscDataProps: { ownerTeams: [PLATFORM_TEAM] },
      },
      carryForward: carryForward,
    } as OnCreate<IncidentEpisode | AlertEpisode>;
  }

  async function create(
    hookInput: OnCreate<IncidentEpisode | AlertEpisode> = onCreate(),
  ): Promise<void> {
    const episode: IncidentEpisode | AlertEpisode = kind.model();
    episode.id = RECORD_ID;
    episode.projectId = PROJECT_ID;
    Object.assign(episode, { [kind.stateColumn]: STATE_ID });

    await hookOf(kind.service, "onCreateSuccess")(hookInput, episode);
  }

  test("REGRESSION (#11188): its owners and labels are in before its channels open and Episode Created is posted, and its pages come after", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(steps).toEqual([
      "privacy",
      "first state",
      "members added",
      "owners picked",
      "owner rules",
      "label rules",
      "owners waited for",
      "channels",
      "Episode Created",
      "note",
      "held messages",
      "on-call rules",
      "paging",
    ]);
  });

  test("its other messages are held from the start of the chain until right after Episode Created and the note", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expectHeldUntil("note");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });

  test("the owners added outside the chain are waited for, for this episode, as its kind, with its create", async () => {
    const hookInput: OnCreate<IncidentEpisode | AlertEpisode> = onCreate();
    const ended: Promise<void> = standIn();
    await create(hookInput);
    await waitFor(ended);

    expect(waitForOwners).toHaveBeenCalledTimes(1);
    expect(waitForOwners.mock.calls[0]![0]).toEqual({
      createBy: hookInput.createBy,
      projectId: PROJECT_ID,
      eventType: kind.eventType,
      recordId: RECORD_ID,
    });
    expect(
      (waitForOwners.mock.calls[0]![0] as { createBy: unknown }).createBy,
    ).toBe(hookInput.createBy);
  });

  test("Episode Created is filed when the episode's feed starts, as onBeforeCreate handed it over", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(episodeCreated.mock.calls[0]![1]).toEqual(FEED_STARTS_AT);
  });

  test("without a feed start handed over, Episode Created is filed as it is written", async () => {
    const ended: Promise<void> = standIn();
    await create(
      onCreate({
        startingStage: StartingStage.Open,
        [kind.idsToAddKey]: [MEMBER_ID],
      }),
    );
    await waitFor(ended);

    expect(episodeCreated.mock.calls[0]![1]).toBeUndefined();
  });

  test("created resolved, it opens no channel, and Episode Created still waits for its owners and labels", async () => {
    const ended: Promise<void> = standIn();
    await create(
      onCreate({
        startingStage: StartingStage.Resolved,
        [kind.idsToAddKey]: [MEMBER_ID],
        feedStartsAt: FEED_STARTS_AT,
      }),
    );
    await waitFor(ended);

    expect(steps).not.toContain("channels");
    expect(steps.indexOf("label rules")).toBeLessThan(
      steps.indexOf("Episode Created"),
    );
    expect(steps.indexOf("held messages")).toBe(
      steps.indexOf("Episode Created") + 2,
    );
  });

  test("a chain that stops short of Episode Created still lets the held messages go", async () => {
    standIn();
    step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
      { fail: true },
    );

    await create();
    await turns();

    expect(steps).not.toContain("Episode Created");
    expect(steps).toContain("held messages");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });
});

describe("a scheduled maintenance event's create chain", () => {
  let waitForOwners: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;
  let eventCreated: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;

  function standIn(): Promise<void> {
    const { ended, end } = chainEnd();

    record = { scheduledMaintenanceId: RECORD_ID };

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.id = RECORD_ID;
    event.projectId = PROJECT_ID;
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(event as never);

    step(
      ScheduledMaintenanceService,
      "createScheduledMaintenanceStateTimelineAsync",
      "first state",
    );
    step(ScheduledMaintenanceService, "addOwners", "owners picked");
    step(
      ScheduledMaintenanceOwnerRuleEngineService,
      "applyRulesToScheduledMaintenance",
      "owner rules",
    );
    step(
      ScheduledMaintenanceLabelRuleEngineService,
      "applyRulesToScheduledMaintenance",
      "label rules",
    );
    waitForOwners = step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
    );
    step(
      ScheduledMaintenanceService,
      "handleScheduledMaintenanceWorkspaceOperationsAsync",
      "channels",
      { result: [] },
    );
    eventCreated = step(
      ScheduledMaintenanceService,
      "createScheduledMaintenanceFeedAsync",
      "Scheduled Maintenance Created",
    );
    step(ChannelMembersNotAddedNotice, "noteAll", "note");
    step(
      RunbookRuleEngineService,
      "applyRulesToScheduledMaintenance",
      "runbooks",
    );
    step(ScheduledMaintenanceService, "refreshReminderSchedule", "reminders");
    step(OpenStackMaintenanceReach, "nameInFeed", "OpenStack reach");
    step(OpenStackProjectNotices, "recordForMaintenance", "OpenStack notices", {
      done: end,
    });

    return ended;
  }

  function onCreate(
    carryForward: Record<string, unknown> | null = {
      feedStartsAt: FEED_STARTS_AT,
    },
  ): OnCreate<ScheduledMaintenance> {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.id = RECORD_ID;
    event.projectId = PROJECT_ID;

    return {
      createBy: {
        data: event,
        props: { isRoot: true },
        miscDataProps: { ownerTeams: [PLATFORM_TEAM] },
      },
      carryForward: carryForward,
    };
  }

  async function create(
    hookInput: OnCreate<ScheduledMaintenance> = onCreate(),
  ): Promise<void> {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.id = RECORD_ID;
    event.projectId = PROJECT_ID;

    await hookOf(ScheduledMaintenanceService, "onCreateSuccess")(
      hookInput,
      event,
    );
  }

  test("REGRESSION (#11188): its first state, owners and labels are in before its channels open and Scheduled Maintenance Created is posted, and its runbooks and reminders come after", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(steps).toEqual([
      "first state",
      "owners picked",
      "owner rules",
      "label rules",
      "owners waited for",
      "channels",
      "Scheduled Maintenance Created",
      "note",
      "held messages",
      "runbooks",
      "reminders",
      "OpenStack reach",
      "OpenStack notices",
    ]);
  });

  test("its other messages are held from the start of the chain until right after Scheduled Maintenance Created and the note", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expectHeldUntil("note");
  });

  test("the owners added outside the chain - its creator's - are waited for, for this event, as a maintenance event", async () => {
    const hookInput: OnCreate<ScheduledMaintenance> = onCreate();
    const ended: Promise<void> = standIn();
    await create(hookInput);
    await waitFor(ended);

    expect(waitForOwners.mock.calls[0]![0]).toEqual({
      createBy: hookInput.createBy,
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      recordId: RECORD_ID,
    });
  });

  test("Scheduled Maintenance Created is filed when its feed starts, as onBeforeCreate handed it over", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(eventCreated.mock.calls[0]![1]).toEqual(FEED_STARTS_AT);
  });

  test("without a feed start handed over, Scheduled Maintenance Created is filed as it is written", async () => {
    const ended: Promise<void> = standIn();
    await create(onCreate(null));
    await waitFor(ended);

    expect(eventCreated.mock.calls[0]![1]).toBeUndefined();
  });

  test("a chain that stops short of Scheduled Maintenance Created still lets the held messages go", async () => {
    standIn();
    step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
      { fail: true },
    );

    await create();
    await turns();

    expect(steps).not.toContain("Scheduled Maintenance Created");
    expect(steps).toContain("held messages");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });
});

describe("a monitor's create chain", () => {
  let waitForOwners: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;
  let announced: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;

  function standIn(): Promise<void> {
    const { ended, end } = chainEnd();

    record = { monitorId: RECORD_ID };

    jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation((() => {
        // no milestones in tests
      }) as never);
    jest
      .spyOn(OpenStackMonitorDependencies, "linkMonitor")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorFirstMeasured, "stampManualMonitorOnCreate")
      .mockResolvedValue(undefined as never);

    step(MonitorService, "changeMonitorStatus", "first status");
    step(MonitorService, "addOwners", "owners picked");
    step(MonitorLabelRuleEngineService, "applyRulesToMonitor", "label rules");
    step(MonitorOwnerRuleEngineService, "applyRulesToMonitor", "owner rules");
    waitForOwners = step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
    );
    step(MonitorService, "getMonitorCreatedMarkdown", "Created read", {
      result: "#### 🌎 Monitor Created",
    });
    announced = step(
      MonitorService,
      "handleWorkspaceOperationsAsync",
      "channels, Monitor Created and note",
    );
    step(
      ServiceLevelObjectiveMonitorRuleEngineService,
      "syncSlosForMonitor",
      "SLOs",
    );
    step(
      StatusPageMonitorRuleEngineService,
      "syncRulesForMonitor",
      "status pages",
    );
    step(MonitorService, "refreshMonitorProbeStatus", "probe status", {
      done: end,
    });

    return ended;
  }

  function onCreate(
    carryForward: Record<string, unknown> | null = {
      feedStartsAt: FEED_STARTS_AT,
    },
  ): OnCreate<Monitor> {
    const monitor: Monitor = new Monitor();
    monitor.id = RECORD_ID;
    monitor.projectId = PROJECT_ID;

    return {
      createBy: {
        data: monitor,
        props: { isRoot: true },
        miscDataProps: { ownerTeams: [PLATFORM_TEAM] },
      },
      carryForward: carryForward,
    };
  }

  async function create(
    hookInput: OnCreate<Monitor> = onCreate(),
  ): Promise<void> {
    const monitor: Monitor = new Monitor();
    monitor.id = RECORD_ID;
    monitor.projectId = PROJECT_ID;
    monitor.name = "Checkout API";
    monitor.monitorType = MonitorType.Manual;
    monitor.currentMonitorStatusId = STATE_ID;

    await hookOf(MonitorService, "onCreateSuccess")(hookInput, monitor);
  }

  // The steps, but billing's: it runs only where billing is on.
  function stepsButBilling(): Array<string> {
    return steps.filter((name: string): boolean => {
      return name !== "billing";
    });
  }

  test("REGRESSION (#11188): its first status, owners and labels are in before its channels open and Monitor Created is posted", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expect(stepsButBilling()).toEqual([
      "first status",
      "owners picked",
      "label rules",
      "owner rules",
      "owners waited for",
      "Created read",
      "channels, Monitor Created and note",
      "held messages",
      "SLOs",
      "status pages",
      "probe status",
    ]);
  });

  test("its other messages are held from the start of the chain until right after Monitor Created", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expectHeldUntil("channels, Monitor Created and note");
  });

  test("the owners added outside the chain - its creator's - are waited for, for this monitor, as a monitor", async () => {
    const hookInput: OnCreate<Monitor> = onCreate();
    const ended: Promise<void> = standIn();
    await create(hookInput);
    await waitFor(ended);

    expect(waitForOwners.mock.calls[0]![0]).toEqual({
      createBy: hookInput.createBy,
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Monitor,
      recordId: RECORD_ID,
    });
  });

  test("Monitor Created is filed when its feed starts, and says what is read once the label rules have run", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    const args: Record<string, unknown> = announced.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(args["postedAt"]).toEqual(FEED_STARTS_AT);
    expect(args["feedInfoInMarkdown"]).toBe("#### 🌎 Monitor Created");
    expect(steps.indexOf("Created read")).toBeGreaterThan(
      steps.indexOf("label rules"),
    );
  });

  test("a chain that stops short of Monitor Created still lets the held messages go", async () => {
    standIn();
    step(
      WorkspaceRuleOwnersOnCreate,
      "waitForOwnersOfCreate",
      "owners waited for",
      { fail: true },
    );

    await create();
    await turns();

    expect(steps).not.toContain("channels, Monitor Created and note");
    expect(steps).toContain("held messages");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });
});

describe("an on-call policy's create", () => {
  let policyCreated: SpyInstance<(...args: Array<unknown>) => Promise<unknown>>;

  function standIn(options: { notFound?: boolean } = {}): void {
    record = { onCallDutyPolicyId: RECORD_ID };

    step(
      OnCallDutyPolicyLabelRuleEngineService,
      "applyRulesToOnCallDutyPolicy",
      "label rules",
    );
    step(
      OnCallDutyPolicyOwnerRuleEngineService,
      "applyRulesToOnCallDutyPolicy",
      "owner rules",
    );

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = RECORD_ID;
    policy.projectId = PROJECT_ID;
    policy.name = "Platform on-call";
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue((options.notFound ? null : policy) as never);

    step(
      OnCallDutyPolicyWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      "channels",
      { result: { channelsCreated: [], membersNotAdded: [] } },
    );
    jest
      .spyOn(
        OnCallDutyPolicyWorkspaceMessages,
        "getOnCallDutyPolicyCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);
    policyCreated = step(
      OnCallDutyPolicyFeedService,
      "createOnCallDutyPolicyFeedItem",
      "On-Call Policy Created",
    );
    step(ChannelMembersNotAddedNotice, "noteAll", "note");
  }

  async function create(
    carryForward: Record<string, unknown> | null = {
      feedStartsAt: FEED_STARTS_AT,
    },
  ): Promise<void> {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = RECORD_ID;
    policy.projectId = PROJECT_ID;

    await hookOf(OnCallDutyPolicyService, "onCreateSuccess")(
      {
        createBy: { data: policy, props: { isRoot: true } },
        carryForward: carryForward,
      },
      policy,
    );
  }

  test("REGRESSION: the owners its rules add wait for On-Call Policy Created, and are let go right after it and the note", async () => {
    standIn();
    await create();

    expect(steps).toEqual([
      "label rules",
      "owner rules",
      "channels",
      "On-Call Policy Created",
      "note",
      "held messages",
    ]);
    expectHeldUntil("note");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });

  test("On-Call Policy Created announces the policy and is filed when its feed starts", async () => {
    standIn();
    await create();

    const entry: Record<string, unknown> = policyCreated.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(entry["postedAt"]).toEqual(FEED_STARTS_AT);
    expect(
      (entry["workspaceNotification"] as Record<string, unknown>)[
        "announcesRecord"
      ],
    ).toBe(true);
  });

  test("without a feed start handed over, it is filed as it is written", async () => {
    standIn();
    await create(null);

    const entry: Record<string, unknown> = policyCreated.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(Object.keys(entry)).not.toContain("postedAt");
  });

  test("a create that fails half way still lets the held messages go", async () => {
    standIn({ notFound: true });

    await expect(create()).rejects.toThrow();

    expect(steps).not.toContain("On-Call Policy Created");
    expect(steps).toContain("held messages");
    expect(WorkspaceCreatedMessageFirst.isHeld(record)).toBe(false);
  });
});

describe("when a record's feed starts", () => {
  // The clock moves a millisecond each time it is read.
  function tickingClock(): SpyInstance<typeof OneUptimeDate.getCurrentDate> {
    let clock: number = FEED_STARTS_AT.getTime();

    return jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockImplementation((): Date => {
        clock += 1;
        return new Date(clock);
      });
  }

  // The read of the clock that gave `at` came before `before` was called.
  function readBefore(
    reads: SpyInstance<typeof OneUptimeDate.getCurrentDate>,
    at: unknown,
    before: SpyInstance<(...args: Array<unknown>) => unknown>,
  ): void {
    expect(at).toBeInstanceOf(Date);

    const readIndex: number = reads.mock.results.findIndex(
      (read: { value: unknown }): boolean => {
        return (read.value as Date).getTime() === (at as Date).getTime();
      },
    );

    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(reads.mock.invocationCallOrder[readIndex]!).toBeLessThan(
      before.mock.invocationCallOrder[0]!,
    );
  }

  test.each([
    [
      "an incident episode's",
      IncidentEpisodeService,
      "incrementAndGetIncidentEpisodeCounter",
      new IncidentEpisode(),
    ],
    [
      "an alert episode's",
      AlertEpisodeService,
      "incrementAndGetAlertEpisodeCounter",
      new AlertEpisode(),
    ],
  ])(
    "%s is read in onBeforeCreate, before it takes its number - so before it is written",
    async (
      _name: string,
      service: unknown,
      counter: string,
      episode: IncidentEpisode | AlertEpisode,
    ) => {
      jest
        .spyOn(
          ProjectScopedReferenceValidator,
          "validateReferencesBelongToProject",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(OwnerRuleAssignment, "checkOwnersPickedOnCreate")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IncidentStateService, "getCreatedIncidentStateId")
        .mockResolvedValue(STATE_ID as never);
      jest
        .spyOn(AlertStateService, "findOneBy")
        .mockResolvedValue({ id: STATE_ID, _id: STATE_ID.toString() } as never);

      const numbered: SpyInstance<(...args: Array<unknown>) => unknown> = jest
        .spyOn(
          ProjectService as unknown as Record<
            string,
            (...args: Array<unknown>) => unknown
          >,
          counter,
        )
        .mockResolvedValue({ counter: 3, prefix: undefined } as never);

      const reads: SpyInstance<typeof OneUptimeDate.getCurrentDate> =
        tickingClock();

      episode.projectId = PROJECT_ID;
      episode.title = "Payments are failing";

      const result: OnCreate<IncidentEpisode | AlertEpisode> = (await hookOf(
        service,
        "onBeforeCreate",
      )({
        data: episode,
        props: { isRoot: true },
      })) as OnCreate<IncidentEpisode | AlertEpisode>;

      readBefore(
        reads,
        (result.carryForward as { feedStartsAt?: unknown }).feedStartsAt,
        numbered,
      );
    },
  );

  test("a maintenance event's is read in onBeforeCreate, before it takes its number - so before it is written", async () => {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state._id = STATE_ID.toString();
    state.id = STATE_ID;

    jest
      .spyOn(OwnerRuleAssignment, "checkOwnersPickedOnCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ScheduledMaintenanceStateService, "findOneBy")
      .mockResolvedValue(state as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
      .mockResolvedValue(undefined as never);

    const numbered: SpyInstance<(...args: Array<unknown>) => unknown> = jest
      .spyOn(
        ScheduledMaintenanceService as unknown as Record<
          string,
          (...args: Array<unknown>) => unknown
        >,
        "takeNextScheduledMaintenanceNumber",
      )
      .mockResolvedValue({ counter: 5, prefix: undefined } as never);

    const reads: SpyInstance<typeof OneUptimeDate.getCurrentDate> =
      tickingClock();

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.projectId = PROJECT_ID;
    event.title = "Database upgrade";

    const result: OnCreate<ScheduledMaintenance> = (await hookOf(
      ScheduledMaintenanceService,
      "onBeforeCreate",
    )({
      data: event,
      props: { isRoot: true },
    })) as OnCreate<ScheduledMaintenance>;

    readBefore(
      reads,
      (result.carryForward as { feedStartsAt?: unknown }).feedStartsAt,
      numbered,
    );
  });
});

describe("the creator of a maintenance event or a monitor is waited for", () => {
  test.each([
    ["a maintenance event", ScheduledMaintenanceService],
    ["a monitor", MonitorService],
  ])(
    "%s's create says its creator is still to be made an owner until it returns - also when it fails",
    async (_name: string, service: unknown) => {
      const seen: Array<boolean> = [];
      let createBy: CreateBy<Monitor> | null = null;

      // The create itself, past its hooks: what it is told while it runs.
      jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(service)) as Record<
            string,
            (...args: Array<unknown>) => Promise<unknown>
          >,
          "create",
        )
        .mockImplementation((async (
          data: CreateBy<Monitor>,
        ): Promise<unknown> => {
          createBy = data;
          seen.push(
            CreatedNotificationHold.isAddingOwners(
              data as unknown as CreateBy<Monitor>,
              [OwnersAddedBy.Create],
            ),
          );
          throw new Error("the database went away");
        }) as never);

      const create: CreateBy<Monitor> = {
        data: new Monitor(),
        props: { isRoot: true },
      };

      await expect(
        (
          service as {
            create: (data: CreateBy<Monitor>) => Promise<unknown>;
          }
        ).create(create),
      ).rejects.toThrow("the database went away");

      expect(createBy).toBe(create);
      expect(seen).toEqual([true]);
      expect(
        CreatedNotificationHold.isAddingOwners(create, [OwnersAddedBy.Create]),
      ).toBe(false);
    },
  );
});
