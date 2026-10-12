import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../Server/Services/AlertService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../Server/Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../Server/Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import ScheduledMaintenanceLabelRuleEngineService from "../../../Server/Services/ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceOwnerRuleEngineService from "../../../Server/Services/ScheduledMaintenanceOwnerRuleEngineService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import { WorkspaceChannelsCreated } from "../../../Server/Services/WorkspaceNotificationRuleService";
import AIAlertInvestigationRunner from "../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import VideoCallRuleExecutor from "../../../Server/Utils/VideoCall/VideoCallRuleExecutor";
import ChannelMembersNotAddedNotice, {
  ChannelMembersNotAdded,
} from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import MonitorWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Monitor";
import OnCallDutyPolicyWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

jest.mock("../../../Server/Utils/Logger");

/*
 * A NEW CHANNEL OPENS ON WHAT HAPPENED, NOT ON WHO IS MISSING FROM IT.
 *
 * When OneUptime creates a Slack channel for an incident, alert, episode,
 * scheduled maintenance event, monitor or on-call policy, it adds the
 * rule's people to it, and some of them may not have connected a Slack
 * account. The note naming them ("Not everyone could be added to this
 * channel") used to be posted while the channel was being set up - so it
 * was the channel's first message, above "Incident INC-8 Created", in the
 * maintainer's screenshot. Channel setup now hands back who it could not
 * add, and each record's service posts the note right after the record's
 * own created message.
 *
 * Each record's real create hook (onCreateSuccess) is driven here, with its
 * other steps stood in for: every step is logged in the order it ran.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000000002",
);
const NB_USER_3: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000000003",
);

const MEMBERS_NOT_ADDED: Array<ChannelMembersNotAdded> = [
  {
    workspaceType: WorkspaceType.Slack,
    channels: [{ id: "C0NEW", name: "inc-8" }],
    userIds: [NB_USER_3],
  },
];

// Every stood-in step, and the note, in the order they ran.
let steps: Array<string> = [];

// What the note was asked to say.
let noted: Array<Record<string, unknown>> = [];

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
  options?: { result?: unknown; fail?: boolean; done?: () => void },
): void {
  jest
    .spyOn(
      target as Record<string, (...args: Array<unknown>) => Promise<unknown>>,
      method,
    )
    .mockImplementation((async (): Promise<unknown> => {
      steps.push(name);

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

function expectNoteRightAfter(created: string): void {
  expect(steps).toContain("workspace");
  expect(steps).toContain(created);
  expect(steps).toContain("note");

  // Set up, announced, then the note - nothing in between.
  expect(steps.indexOf("workspace")).toBeLessThan(steps.indexOf(created));
  expect(steps.indexOf("note")).toBe(steps.indexOf(created) + 1);

  expect(noted).toEqual([
    {
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      channels: [{ id: "C0NEW", name: "inc-8" }],
      userIds: [NB_USER_3],
    },
  ]);
}

beforeEach(() => {
  steps = [];
  noted = [];

  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);

  jest
    .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
    .mockImplementation(
      async (data: Record<string, unknown> | never): Promise<void> => {
        steps.push("note");
        noted.push(data as Record<string, unknown>);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident's new channel", () => {
  function standIn(
    options: { workspace?: unknown; createdFails?: boolean } = {},
  ): Promise<void> {
    const { ended, end } = chainEnd();

    const incident: Incident = new Incident();
    incident.id = RECORD_ID;
    incident.projectId = PROJECT_ID;
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    step(IncidentPrivacyRuleEngineService, "applyRulesToIncident", "privacy");
    step(IncidentService, "handleIncidentWorkspaceOperationsAsync", "workspace", {
      result:
        "workspace" in options ? options.workspace : MEMBERS_NOT_ADDED,
    });
    step(IncidentService, "createIncidentFeedAsync", "Incident Created", {
      fail: Boolean(options.createdFails),
    });
    step(VideoCallRuleExecutor, "startCallsForIncident", "video calls");
    step(IncidentService, "handleIncidentStateChangeAsync", "first state");
    step(IncidentService, "disableActiveMonitoringIfManualIncident", "pause");
    step(IncidentOwnerRuleEngineService, "applyRulesToIncident", "owners");
    step(IncidentLabelRuleEngineService, "applyRulesToIncident", "labels");
    step(IncidentOnCallRuleEngineService, "applyRulesToIncident", "on-call");
    step(RunbookRuleEngineService, "applyRulesToIncident", "runbooks");
    step(IncidentGroupingEngineService, "processIncident", "grouping");
    step(IncidentSlaService, "createSlaForIncident", "sla");
    step(IncidentService, "refreshReminderSchedule", "reminders");
    step(AIIncidentInvestigationRunner, "investigateNewIncident", "ai", {
      result: false,
    });
    step(AutoRemediationRuleEngineService, "onIncidentCreated", "remediation", {
      done: end,
    });

    return ended;
  }

  async function create(): Promise<void> {
    const incident: Incident = new Incident();
    incident.id = RECORD_ID;
    incident.projectId = PROJECT_ID;

    await hookOf(IncidentService, "onCreateSuccess")(
      { createBy: { data: incident, props: { isRoot: true } }, carryForward: null },
      incident,
    );
  }

  test("REGRESSION: the note comes right after 'Incident Created', not above it", async () => {
    const ended: Promise<void> = standIn();
    await create();
    await waitFor(ended);

    expectNoteRightAfter("Incident Created");
    // And before the rest of the incident's setup: paging comes after it.
    expect(steps.indexOf("note")).toBeLessThan(steps.indexOf("on-call"));
  });

  test("an 'Incident Created' that could not be posted still lets the channel be told", async () => {
    const ended: Promise<void> = standIn({ createdFails: true });
    await create();
    await waitFor(ended);

    expectNoteRightAfter("Incident Created");
  });

  test("everybody could be added: nothing is noted", async () => {
    const ended: Promise<void> = standIn({ workspace: [] });
    await create();
    await waitFor(ended);

    expect(steps).toContain("Incident Created");
    expect(steps).not.toContain("note");
  });

  test("channel setup that failed outright: nothing to note, and the rest goes on", async () => {
    const ended: Promise<void> = standIn();
    step(IncidentService, "handleIncidentWorkspaceOperationsAsync", "workspace", {
      fail: true,
    });
    await create();
    await waitFor(ended);

    expect(steps).toContain("Incident Created");
    expect(steps).not.toContain("note");
    expect(steps).toContain("remediation");
  });
});

describe("an alert's new channel", () => {
  test("REGRESSION: the note comes right after 'Alert Created', not above it", async () => {
    const { ended, end } = chainEnd();

    step(AlertPrivacyRuleEngineService, "applyRulesToAlert", "privacy");
    step(AlertService, "handleAlertWorkspaceOperationsAsync", "workspace", {
      result: MEMBERS_NOT_ADDED,
    });
    step(AlertService, "createAlertFeedAsync", "Alert Created");
    step(VideoCallRuleExecutor, "startCallsForAlert", "video calls");
    step(AlertService, "handleAlertStateChangeAsync", "first state");
    step(AlertOwnerRuleEngineService, "applyRulesToAlert", "owners");
    step(AlertLabelRuleEngineService, "applyRulesToAlert", "labels");
    step(AlertOnCallRuleEngineService, "applyRulesToAlert", "on-call");
    step(RunbookRuleEngineService, "applyRulesToAlert", "runbooks");
    step(AlertGroupingEngineService, "processAlert", "grouping");
    step(AlertService, "refreshReminderSchedule", "reminders");
    step(AIAlertInvestigationRunner, "investigateNewAlert", "ai", {
      result: false,
    });
    step(AutoRemediationRuleEngineService, "onAlertCreated", "remediation", {
      done: end,
    });

    const alert: Alert = new Alert();
    alert.id = RECORD_ID;
    alert.projectId = PROJECT_ID;
    alert.currentAlertStateId = ObjectID.generate();

    await hookOf(AlertService, "onCreateSuccess")(
      { createBy: { data: alert, props: { isRoot: true } }, carryForward: null },
      alert,
    );
    await waitFor(ended);

    expectNoteRightAfter("Alert Created");
    expect(steps.indexOf("note")).toBeLessThan(steps.indexOf("on-call"));
  });
});

describe("an episode's new channel", () => {
  test("REGRESSION: an incident episode - the note comes right after the episode's created message", async () => {
    const { ended, end } = chainEnd();

    step(
      IncidentEpisodePrivacyRuleEngineService,
      "applyRulesToEpisode",
      "privacy",
    );
    step(
      IncidentEpisodeService,
      "handleEpisodeWorkspaceOperationsAsync",
      "workspace",
      { result: MEMBERS_NOT_ADDED },
    );
    step(IncidentEpisodeService, "changeEpisodeState", "first state");
    step(IncidentEpisodeService, "createEpisodeCreatedFeed", "Episode Created");
    step(IncidentEpisodeOwnerRuleEngineService, "applyRulesToEpisode", "owners");
    step(IncidentEpisodeLabelRuleEngineService, "applyRulesToEpisode", "labels");
    step(
      IncidentEpisodeOnCallRuleEngineService,
      "applyRulesToEpisode",
      "on-call",
    );
    step(
      IncidentEpisodeService,
      "executeEpisodeOnCallDutyPoliciesAsync",
      "paging",
      { done: end },
    );

    const episode: IncidentEpisode = new IncidentEpisode();
    episode.id = RECORD_ID;
    episode.projectId = PROJECT_ID;
    episode.currentIncidentStateId = ObjectID.generate();

    await hookOf(IncidentEpisodeService, "onCreateSuccess")(
      {
        createBy: { data: episode, props: { isRoot: true } },
        carryForward: null,
      },
      episode,
    );
    await waitFor(ended);

    expectNoteRightAfter("Episode Created");
    expect(steps.indexOf("note")).toBeLessThan(steps.indexOf("paging"));
  });

  test("REGRESSION: an alert episode - the note comes right after the episode's created message", async () => {
    const { ended, end } = chainEnd();

    step(AlertEpisodePrivacyRuleEngineService, "applyRulesToEpisode", "privacy");
    step(
      AlertEpisodeService,
      "handleEpisodeWorkspaceOperationsAsync",
      "workspace",
      { result: MEMBERS_NOT_ADDED },
    );
    step(AlertEpisodeService, "changeEpisodeState", "first state");
    step(AlertEpisodeService, "createEpisodeCreatedFeed", "Episode Created");
    step(AlertEpisodeOwnerRuleEngineService, "applyRulesToEpisode", "owners");
    step(AlertEpisodeLabelRuleEngineService, "applyRulesToEpisode", "labels");
    step(AlertEpisodeOnCallRuleEngineService, "applyRulesToEpisode", "on-call");
    step(
      AlertEpisodeService,
      "executeEpisodeOnCallDutyPoliciesAsync",
      "paging",
      { done: end },
    );

    const episode: AlertEpisode = new AlertEpisode();
    episode.id = RECORD_ID;
    episode.projectId = PROJECT_ID;
    episode.currentAlertStateId = ObjectID.generate();

    await hookOf(AlertEpisodeService, "onCreateSuccess")(
      {
        createBy: { data: episode, props: { isRoot: true } },
        carryForward: null,
      },
      episode,
    );
    await waitFor(ended);

    expectNoteRightAfter("Episode Created");
  });
});

describe("a scheduled maintenance event's new channel", () => {
  test("REGRESSION: the note comes right after 'Scheduled Maintenance Created', not above it", async () => {
    const { ended, end } = chainEnd();

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.id = RECORD_ID;
    event.projectId = PROJECT_ID;

    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(event as never);

    step(
      ScheduledMaintenanceService,
      "handleScheduledMaintenanceWorkspaceOperationsAsync",
      "workspace",
      { result: MEMBERS_NOT_ADDED },
    );
    step(
      ScheduledMaintenanceService,
      "createScheduledMaintenanceFeedAsync",
      "Scheduled Maintenance Created",
    );
    step(
      ScheduledMaintenanceService,
      "createScheduledMaintenanceStateTimelineAsync",
      "first state",
    );
    step(
      ScheduledMaintenanceOwnerRuleEngineService,
      "applyRulesToScheduledMaintenance",
      "owners",
    );
    step(
      ScheduledMaintenanceLabelRuleEngineService,
      "applyRulesToScheduledMaintenance",
      "labels",
    );
    step(RunbookRuleEngineService, "applyRulesToScheduledMaintenance", "runbooks");
    step(ScheduledMaintenanceService, "refreshReminderSchedule", "reminders", {
      done: end,
    });

    await hookOf(ScheduledMaintenanceService, "onCreateSuccess")(
      { createBy: { data: event, props: { isRoot: true } }, carryForward: null },
      event,
    );
    await waitFor(ended);

    expectNoteRightAfter("Scheduled Maintenance Created");
    expect(steps.indexOf("note")).toBeLessThan(steps.indexOf("first state"));
  });
});

describe("a monitor's and an on-call policy's new channel", () => {
  const CREATED: WorkspaceChannelsCreated = {
    channelsCreated: [
      {
        id: "C0NEW",
        name: "inc-8",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: "rule-1",
      },
    ],
    membersNotAdded: MEMBERS_NOT_ADDED,
  };

  test("a monitor: the note comes right after 'Monitor Created'", async () => {
    step(
      MonitorWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      "workspace",
      { result: CREATED },
    );
    step(MonitorService, "updateOneById", "channels kept", { result: 1 });
    step(MonitorWorkspaceMessages, "getMonitorCreateMessageBlocks", "blocks", {
      result: [],
    });
    step(MonitorFeedService, "createMonitorFeedItem", "Monitor Created");

    await hookOf(MonitorService, "handleWorkspaceOperationsAsync")({
      projectId: PROJECT_ID,
      monitorId: RECORD_ID,
      monitorName: "Checkout API",
      feedInfoInMarkdown: "Monitor Created",
      createdByUserId: undefined,
    });

    expectNoteRightAfter("Monitor Created");
  });

  test("an on-call policy: the note comes right after 'On Call Policy Created'", async () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = RECORD_ID;
    policy.projectId = PROJECT_ID;
    policy.name = "PolicyX";

    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(policy as never);

    step(
      OnCallDutyPolicyLabelRuleEngineService,
      "applyRulesToOnCallDutyPolicy",
      "labels",
    );
    step(
      OnCallDutyPolicyOwnerRuleEngineService,
      "applyRulesToOnCallDutyPolicy",
      "owners",
    );
    step(
      OnCallDutyPolicyWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      "workspace",
      { result: CREATED },
    );
    step(OnCallDutyPolicyService, "updateOneById", "channels kept", {
      result: 1,
    });
    step(
      OnCallDutyPolicyWorkspaceMessages,
      "getOnCallDutyPolicyCreateMessageBlocks",
      "blocks",
      { result: [] },
    );
    step(
      OnCallDutyPolicyFeedService,
      "createOnCallDutyPolicyFeedItem",
      "On Call Policy Created",
    );

    await hookOf(OnCallDutyPolicyService, "onCreateSuccess")(
      { createBy: { data: policy, props: { isRoot: true } }, carryForward: null },
      policy,
    );

    expectNoteRightAfter("On Call Policy Created");
  });
});
