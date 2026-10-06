import AIAlertInvestigationRunner from "../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import InvestigationEligibility from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import AlertEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/AlertEpisode";
import AlertWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "../../../Types/ObjectID";
import { Gray500 } from "../../../Types/BrandColors";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import { StartingStage } from "../../../Utils/StartingStage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

jest.mock("../../../Server/Utils/Logger");

/*
 * A record created already acknowledged or resolved pages nobody.
 *
 * Declare Incident honours its Initial State since #4414, and since #4428
 * so do Create Alert and both Create Episode forms, the API, Terraform and
 * workflows. But the create hooks went on setting off everything a live
 * record sets off, whatever state it started in: the first escalation rule
 * of every on-call policy paged its people, a grouping rule could open an
 * episode that paged again, runbook and auto-remediation rules acted, an AI
 * investigation was queued and a war-room channel was opened in Slack or
 * Microsoft Teams - for an incident that was over before it was recorded.
 * An incident declared resolved with a monitor status also left its
 * monitors in that status with their monitoring paused for good, and one
 * declared acknowledged had its SLA's response deadline missed for it.
 *
 * Now one rule holds for all four kinds:
 *
 *   - Created at or past the acknowledged state (its place in the project's
 *     list is at or below the acknowledged state's): no on-call policy runs,
 *     and its feed says so in one line, naming the policies.
 *   - Created at or past the resolved state: also not grouped into an
 *     episode, no runbook or auto-remediation rule acts on it, no AI
 *     investigation is queued (its AI card says why), no war-room channel is
 *     opened, and an incident leaves its monitors and their monitoring
 *     alone and starts no SLA.
 *   - Its owners, its created feed entry, its first timeline row and its
 *     rules (privacy, owners, labels, on-call) still happen: a record that
 *     is already over is still news.
 *   - A record created in the created state - the default, and every one a
 *     monitor opens - or in a state before acknowledged behaves exactly as
 *     before.
 *
 * Each create goes through the service's real hooks: onBeforeCreate, then
 * onCreateSuccess with what onBeforeCreate handed over, as DatabaseService
 * does. Which records the project has is a stand-in, and so is every
 * service the chain calls out to.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4ccc-8ddd-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4ccc-8ddd-0000000000d1",
);
const SEVERITY_ID: string = "0193c0de-5a7e-4ccc-8ddd-0000000000e1";
const MONITOR_ID: string = "0193c0de-5a7e-4ccc-8ddd-0000000000f1";
const DEGRADED_STATUS_ID: string = "0193c0de-5a7e-4ccc-8ddd-0000000000f2";
const PRIMARY_POLICY_ID: string = "0193c0de-5a7e-4ccc-8ddd-0000000000b1";
const DATABASE_POLICY_ID: string = "0193c0de-5a7e-4ccc-8ddd-0000000000b2";

/*
 * The project's states, in their order: the three built-ins, a state of the
 * project's own before acknowledged and one after it.
 */
const CREATED: string = "0193c0de-5a7e-4ccc-8ddd-0000000000a1";
const INVESTIGATING: string = "0193c0de-5a7e-4ccc-8ddd-0000000000a2";
const ACKNOWLEDGED: string = "0193c0de-5a7e-4ccc-8ddd-0000000000a3";
const MONITORING: string = "0193c0de-5a7e-4ccc-8ddd-0000000000a4";
const RESOLVED: string = "0193c0de-5a7e-4ccc-8ddd-0000000000a5";

interface StateRow {
  id: string;
  name: string;
  order: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

const PROJECT_STATES: Array<StateRow> = [
  { id: CREATED, name: "Identified", order: 1, isCreatedState: true },
  { id: INVESTIGATING, name: "Investigating", order: 2 },
  {
    id: ACKNOWLEDGED,
    name: "Acknowledged",
    order: 3,
    isAcknowledgedState: true,
  },
  { id: MONITORING, name: "Monitoring", order: 4 },
  { id: RESOLVED, name: "Resolved", order: 5, isResolvedState: true },
];

const POLICY_NAMES: Record<string, string> = {
  [PRIMARY_POLICY_ID]: "Primary",
  [DATABASE_POLICY_ID]: "Database [team]",
};

type StateModel = AlertState | IncidentState;

type AnyFunction = (...args: Array<unknown>) => unknown;

/*
 * What a create set off, as the stand-ins saw it. Every list holds one entry
 * per call.
 */
interface Probes {
  // OnCallDutyPolicyService.executePolicy: the policy and its options.
  paged: Array<{ policyId: string; options: Record<string, unknown> }>;
  warRoom: Array<unknown>;
  grouped: Array<unknown>;
  runbooks: Array<unknown>;
  remediated: Array<Record<string, unknown>>;
  investigated: Array<unknown>;
  // InvestigationEligibility.recordSkipped: the code recorded.
  investigationSkipped: Array<string>;
  sla: Array<Record<string, unknown>>;
  monitorStatus: Array<Array<unknown>>;
  monitoringPaused: Array<unknown>;
  // The state of the record's first timeline row.
  firstRows: Array<string>;
  createdFeed: Array<unknown>;
  privacyRules: Array<unknown>;
  ownerRules: Array<unknown>;
  labelRules: Array<unknown>;
  onCallRules: Array<unknown>;
  reminders: Array<unknown>;
  // Every item written to the record's own feed.
  feed: Array<Record<string, unknown>>;
  // Rows written back to an episode (isOnCallPolicyExecuted).
  episodeUpdates: Array<Record<string, unknown>>;
}

function newProbes(): Probes {
  return {
    paged: [],
    warRoom: [],
    grouped: [],
    runbooks: [],
    remediated: [],
    investigated: [],
    investigationSkipped: [],
    sla: [],
    monitorStatus: [],
    monitoringPaused: [],
    firstRows: [],
    createdFeed: [],
    privacyRules: [],
    ownerRules: [],
    labelRules: [],
    onCallRules: [],
    reminders: [],
    feed: [],
    episodeUpdates: [],
  };
}

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

/*
 * Replaces `method` on `target` with a stand-in that records each call and
 * answers what `answer` returns.
 */
function stub(
  target: unknown,
  method: string,
  record?: (args: Array<unknown>) => void,
  answer?: (args: Array<unknown>) => unknown,
): void {
  jest
    .spyOn(target as Record<string, AnyFunction>, method)
    .mockImplementation((async (...args: Array<unknown>): Promise<unknown> => {
      if (record) {
        record(args);
      }
      return answer ? answer(args) : undefined;
    }) as never);
}

function policyStubs(ids: Array<string>): Array<OnCallDutyPolicy> {
  return ids.map((id: string): OnCallDutyPolicy => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = id;
    return policy;
  });
}

// The policies a find names, with their names, as the database answers.
function answerPolicies(args: Array<unknown>): Array<OnCallDutyPolicy> {
  const findBy: { query?: Record<string, unknown> } = (args[0] || {}) as {
    query?: Record<string, unknown>;
  };
  const asked: string = JSON.stringify(findBy.query || {}).toLowerCase();

  return Object.keys(POLICY_NAMES)
    .filter((id: string): boolean => {
      return asked.includes(id.toLowerCase());
    })
    .map((id: string): OnCallDutyPolicy => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = id;
      policy.name = POLICY_NAMES[id]!;
      return policy;
    });
}

interface Kind {
  name: "incident" | "alert" | "alert episode" | "incident episode";
  service: unknown;
  stateService: unknown;
  stateModel: new () => StateModel;
  // The state's ID column.
  idColumn: string;
  // How the record is named in its own feed: "incident", "alert", "episode".
  noun: string;
  feedEventTypeKey: string;
  // The key its feed items name the record under: "incidentId".
  feedRecordKey: string;
  onCallPolicyEventType: string;
  // The automations this kind has at all.
  has: {
    grouping: boolean;
    runbooks: boolean;
    remediation: boolean;
    investigation: boolean;
    sla: boolean;
    monitorStatus: boolean;
    reminders: boolean;
  };
  // A create payload, as the create form or the API sends it.
  newRecord: (policyIds: Array<string>) => DatabaseBaseModel;
  // Stand-ins for every service the create hooks call out to.
  stubHooks: (probes: Probes, policyIds: Array<string>) => void;
}

function stubOnCallExecution(probes: Probes): void {
  stub(OnCallDutyPolicyService, "executePolicy", (args: Array<unknown>) => {
    probes.paged.push({
      policyId: idOf(args[0]),
      options: args[1] as Record<string, unknown>,
    });
  });
  stub(OnCallDutyPolicyService, "findBy", undefined, answerPolicies);
}

const INCIDENT: Kind = {
  name: "incident",
  service: IncidentService,
  stateService: IncidentStateService,
  stateModel: IncidentState,
  idColumn: "currentIncidentStateId",
  noun: "incident",
  feedEventTypeKey: "incidentFeedEventType",
  feedRecordKey: "incidentId",
  onCallPolicyEventType: IncidentFeedEventType.OnCallPolicy,
  has: {
    grouping: true,
    runbooks: true,
    remediation: true,
    investigation: true,
    sla: true,
    monitorStatus: true,
    reminders: true,
  },
  newRecord: (policyIds: Array<string>): DatabaseBaseModel => {
    const incident: Incident = new Incident();
    incident.title = "Checkout is failing";
    incident.incidentSeverityId = new ObjectID(SEVERITY_ID);
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    incident.monitors = [monitor];
    incident.changeMonitorStatusToId = new ObjectID(DEGRADED_STATUS_ID);
    incident.onCallDutyPolicies = policyStubs(policyIds);
    return incident;
  },
  stubHooks: (probes: Probes): void => {
    stub(ProjectService, "incrementAndGetIncidentCounter", undefined, () => {
      return { counter: 42, prefix: undefined };
    });
    stub(ProductAnalytics, "captureForUser");
    stub(IncidentService, "findOneById", undefined, () => {
      const incident: Incident = new Incident();
      incident._id = RECORD_ID.toString();
      incident.projectId = PROJECT_ID;
      incident.incidentNumber = 42;
      return incident;
    });
    stub(
      IncidentPrivacyRuleEngineService,
      "applyRulesToIncident",
      (args: Array<unknown>) => {
        probes.privacyRules.push(args[0]);
      },
    );
    stub(
      IncidentWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      (args: Array<unknown>) => {
        probes.warRoom.push(args[0]);
      },
      () => {
        return null;
      },
    );
    stub(IncidentService, "createIncidentFeedAsync", (args: Array<unknown>) => {
      probes.createdFeed.push(args[0]);
    });
    stub(IncidentService, "changeIncidentState", (args: Array<unknown>) => {
      probes.firstRows.push(
        idOf((args[0] as { incidentStateId: unknown }).incidentStateId),
      );
    });
    stub(MonitorService, "changeMonitorStatus", (args: Array<unknown>) => {
      probes.monitorStatus.push(args);
    });
    stub(
      IncidentService,
      "disableActiveMonitoringIfManualIncident",
      (args: Array<unknown>) => {
        probes.monitoringPaused.push(args[0]);
      },
    );
    stub(
      IncidentOwnerRuleEngineService,
      "applyRulesToIncident",
      (args: Array<unknown>) => {
        probes.ownerRules.push(args[0]);
      },
    );
    stub(
      IncidentLabelRuleEngineService,
      "applyRulesToIncident",
      (args: Array<unknown>) => {
        probes.labelRules.push(args[0]);
      },
    );
    stub(
      IncidentOnCallRuleEngineService,
      "applyRulesToIncident",
      (args: Array<unknown>) => {
        probes.onCallRules.push(args[0]);
      },
    );
    stub(
      RunbookRuleEngineService,
      "applyRulesToIncident",
      (args: Array<unknown>) => {
        probes.runbooks.push(args[0]);
      },
    );
    stubOnCallExecution(probes);
    stub(
      IncidentGroupingEngineService,
      "processIncident",
      (args: Array<unknown>) => {
        probes.grouped.push(args[0]);
      },
      () => {
        return { grouped: false };
      },
    );
    stub(
      IncidentSlaService,
      "createSlaForIncident",
      (args: Array<unknown>) => {
        probes.sla.push(args[0] as Record<string, unknown>);
      },
      () => {
        return null;
      },
    );
    stub(IncidentService, "refreshReminderSchedule", (args: Array<unknown>) => {
      probes.reminders.push(args[0]);
    });
    stub(
      AIIncidentInvestigationRunner,
      "investigateNewIncident",
      (args: Array<unknown>) => {
        probes.investigated.push(args[0]);
      },
      () => {
        return false;
      },
    );
    stub(InvestigationEligibility, "recordSkipped", (args: Array<unknown>) => {
      probes.investigationSkipped.push(String(args[1]));
    });
    stub(
      AutoRemediationRuleEngineService,
      "onIncidentCreated",
      (args: Array<unknown>) => {
        probes.remediated.push(args[0] as Record<string, unknown>);
      },
    );
    stub(
      IncidentFeedService,
      "createIncidentFeedItem",
      (args: Array<unknown>) => {
        probes.feed.push(args[0] as Record<string, unknown>);
      },
    );
  },
};

const ALERT: Kind = {
  name: "alert",
  service: AlertService,
  stateService: AlertStateService,
  stateModel: AlertState,
  idColumn: "currentAlertStateId",
  noun: "alert",
  feedEventTypeKey: "alertFeedEventType",
  feedRecordKey: "alertId",
  onCallPolicyEventType: AlertFeedEventType.OnCallPolicy,
  has: {
    grouping: true,
    runbooks: true,
    remediation: true,
    investigation: true,
    sla: false,
    monitorStatus: false,
    reminders: true,
  },
  newRecord: (policyIds: Array<string>): DatabaseBaseModel => {
    const alert: Alert = new Alert();
    alert.title = "Disk is full";
    alert.onCallDutyPolicies = policyStubs(policyIds);
    return alert;
  },
  stubHooks: (probes: Probes): void => {
    stub(ProjectService, "incrementAndGetAlertCounter", undefined, () => {
      return { counter: 42, prefix: undefined };
    });
    stub(
      AlertPrivacyRuleEngineService,
      "applyRulesToAlert",
      (args: Array<unknown>) => {
        probes.privacyRules.push(args[0]);
      },
    );
    stub(
      AlertWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      (args: Array<unknown>) => {
        probes.warRoom.push(args[0]);
      },
      () => {
        return null;
      },
    );
    stub(AlertService, "createAlertFeedAsync", (args: Array<unknown>) => {
      probes.createdFeed.push(args[0]);
    });
    stub(AlertService, "changeAlertState", (args: Array<unknown>) => {
      probes.firstRows.push(
        idOf((args[0] as { alertStateId: unknown }).alertStateId),
      );
    });
    stub(
      AlertOwnerRuleEngineService,
      "applyRulesToAlert",
      (args: Array<unknown>) => {
        probes.ownerRules.push(args[0]);
      },
    );
    stub(
      AlertLabelRuleEngineService,
      "applyRulesToAlert",
      (args: Array<unknown>) => {
        probes.labelRules.push(args[0]);
      },
    );
    stub(
      AlertOnCallRuleEngineService,
      "applyRulesToAlert",
      (args: Array<unknown>) => {
        probes.onCallRules.push(args[0]);
      },
    );
    stub(
      RunbookRuleEngineService,
      "applyRulesToAlert",
      (args: Array<unknown>) => {
        probes.runbooks.push(args[0]);
      },
    );
    stubOnCallExecution(probes);
    stub(
      AlertGroupingEngineService,
      "processAlert",
      (args: Array<unknown>) => {
        probes.grouped.push(args[0]);
      },
      () => {
        return { grouped: false };
      },
    );
    stub(AlertService, "refreshReminderSchedule", (args: Array<unknown>) => {
      probes.reminders.push(args[0]);
    });
    stub(
      AIAlertInvestigationRunner,
      "investigateNewAlert",
      (args: Array<unknown>) => {
        probes.investigated.push(args[0]);
      },
      () => {
        return false;
      },
    );
    stub(InvestigationEligibility, "recordSkipped", (args: Array<unknown>) => {
      probes.investigationSkipped.push(String(args[1]));
    });
    stub(
      AutoRemediationRuleEngineService,
      "onAlertCreated",
      (args: Array<unknown>) => {
        probes.remediated.push(args[0] as Record<string, unknown>);
      },
    );
    stub(AlertFeedService, "createAlertFeedItem", (args: Array<unknown>) => {
      probes.feed.push(args[0] as Record<string, unknown>);
    });
  },
};

// The episode a create wrote, as its on-call step reads it back.
function storedEpisode(
  model: new () => AlertEpisode | IncidentEpisode,
  policyIds: Array<string>,
): AlertEpisode | IncidentEpisode {
  const episode: AlertEpisode | IncidentEpisode = new model();
  episode._id = RECORD_ID.toString();
  episode.onCallDutyPolicies = policyIds.map((id: string): OnCallDutyPolicy => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = id;
    policy.name = POLICY_NAMES[id]!;
    return policy;
  });
  return episode;
}

const ALERT_EPISODE: Kind = {
  name: "alert episode",
  service: AlertEpisodeService,
  stateService: AlertStateService,
  stateModel: AlertState,
  idColumn: "currentAlertStateId",
  noun: "episode",
  feedEventTypeKey: "alertEpisodeFeedEventType",
  feedRecordKey: "alertEpisodeId",
  onCallPolicyEventType: AlertEpisodeFeedEventType.OnCallPolicy,
  has: {
    grouping: false,
    runbooks: false,
    remediation: false,
    investigation: false,
    sla: false,
    monitorStatus: false,
    reminders: false,
  },
  newRecord: (): DatabaseBaseModel => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.title = "Disk alerts";
    return episode;
  },
  stubHooks: (probes: Probes, policyIds: Array<string>): void => {
    stub(
      ProjectService,
      "incrementAndGetAlertEpisodeCounter",
      undefined,
      () => {
        return { counter: 42, prefix: undefined };
      },
    );
    stub(
      AlertEpisodePrivacyRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.privacyRules.push(args[0]);
      },
    );
    stub(
      AlertEpisodeWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      (args: Array<unknown>) => {
        probes.warRoom.push(args[0]);
      },
      () => {
        return null;
      },
    );
    stub(AlertEpisodeService, "changeEpisodeState", (args: Array<unknown>) => {
      probes.firstRows.push(
        idOf((args[0] as { alertStateId: unknown }).alertStateId),
      );
    });
    stub(
      AlertEpisodeService,
      "createEpisodeCreatedFeed",
      (args: Array<unknown>) => {
        probes.createdFeed.push(args[0]);
      },
    );
    stub(
      AlertEpisodeOwnerRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.ownerRules.push(args[0]);
      },
    );
    stub(
      AlertEpisodeLabelRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.labelRules.push(args[0]);
      },
    );
    stub(
      AlertEpisodeOnCallRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.onCallRules.push(args[0]);
      },
    );
    stub(AlertEpisodeService, "findOneById", undefined, () => {
      return storedEpisode(AlertEpisode, policyIds);
    });
    stub(AlertEpisodeService, "updateOneById", (args: Array<unknown>) => {
      probes.episodeUpdates.push(
        (args[0] as { data: Record<string, unknown> }).data,
      );
    });
    stubOnCallExecution(probes);
    stub(
      AlertEpisodeFeedService,
      "createAlertEpisodeFeedItem",
      (args: Array<unknown>) => {
        probes.feed.push(args[0] as Record<string, unknown>);
      },
    );
  },
};

const INCIDENT_EPISODE: Kind = {
  name: "incident episode",
  service: IncidentEpisodeService,
  stateService: IncidentStateService,
  stateModel: IncidentState,
  idColumn: "currentIncidentStateId",
  noun: "episode",
  feedEventTypeKey: "incidentEpisodeFeedEventType",
  feedRecordKey: "incidentEpisodeId",
  onCallPolicyEventType: IncidentEpisodeFeedEventType.OnCallPolicy,
  has: {
    grouping: false,
    runbooks: false,
    remediation: false,
    investigation: false,
    sla: false,
    monitorStatus: false,
    reminders: false,
  },
  newRecord: (): DatabaseBaseModel => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.title = "Checkout errors";
    return episode;
  },
  stubHooks: (probes: Probes, policyIds: Array<string>): void => {
    stub(
      ProjectService,
      "incrementAndGetIncidentEpisodeCounter",
      undefined,
      () => {
        return { counter: 42, prefix: undefined };
      },
    );
    stub(
      IncidentEpisodePrivacyRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.privacyRules.push(args[0]);
      },
    );
    stub(
      IncidentEpisodeWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
      (args: Array<unknown>) => {
        probes.warRoom.push(args[0]);
      },
      () => {
        return null;
      },
    );
    stub(
      IncidentEpisodeService,
      "changeEpisodeState",
      (args: Array<unknown>) => {
        probes.firstRows.push(
          idOf((args[0] as { incidentStateId: unknown }).incidentStateId),
        );
      },
    );
    stub(
      IncidentEpisodeService,
      "createEpisodeCreatedFeed",
      (args: Array<unknown>) => {
        probes.createdFeed.push(args[0]);
      },
    );
    stub(
      IncidentEpisodeOwnerRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.ownerRules.push(args[0]);
      },
    );
    stub(
      IncidentEpisodeLabelRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.labelRules.push(args[0]);
      },
    );
    stub(
      IncidentEpisodeOnCallRuleEngineService,
      "applyRulesToEpisode",
      (args: Array<unknown>) => {
        probes.onCallRules.push(args[0]);
      },
    );
    stub(IncidentEpisodeService, "findOneById", undefined, () => {
      return storedEpisode(IncidentEpisode, policyIds);
    });
    stub(IncidentEpisodeService, "updateOneById", (args: Array<unknown>) => {
      probes.episodeUpdates.push(
        (args[0] as { data: Record<string, unknown> }).data,
      );
    });
    stubOnCallExecution(probes);
    stub(
      IncidentEpisodeFeedService,
      "createIncidentEpisodeFeedItem",
      (args: Array<unknown>) => {
        probes.feed.push(args[0] as Record<string, unknown>);
      },
    );
  },
};

const KINDS: Array<Kind> = [INCIDENT, ALERT, ALERT_EPISODE, INCIDENT_EPISODE];

// Each read of the project's states a create made.
let stateReads: number = 0;

// Each read of the project's whole state list (where a record starts).
let stateListReads: number = 0;

/*
 * The project's states, answered the way the database would: one by id or
 * by the created-state flag, or the whole list in its order.
 */
function stubStates(kind: Kind): void {
  const toModel: (row: StateRow) => StateModel = (row: StateRow) => {
    const state: StateModel = new kind.stateModel();
    state._id = row.id;
    state.name = row.name;
    state.order = row.order;
    state.isCreatedState = Boolean(row.isCreatedState);
    state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
    state.isResolvedState = Boolean(row.isResolvedState);
    return state;
  };

  stub(
    kind.stateService,
    "findOneBy",
    () => {
      stateReads++;
    },
    (args: Array<unknown>): StateModel | null => {
      const query: Record<string, unknown> = (
        args[0] as { query: Record<string, unknown> }
      ).query;

      if (idOf(query["projectId"]) !== idOf(PROJECT_ID)) {
        return null;
      }

      const row: StateRow | undefined = PROJECT_STATES.find(
        (state: StateRow): boolean => {
          if (query["isCreatedState"] === true) {
            return Boolean(state.isCreatedState);
          }
          return state.id === idOf(query["_id"]);
        },
      );

      return row ? toModel(row) : null;
    },
  );

  stub(
    kind.stateService,
    "findBy",
    () => {
      stateReads++;
      stateListReads++;
    },
    (args: Array<unknown>): Array<StateModel> => {
      const query: Record<string, unknown> = (
        args[0] as { query: Record<string, unknown> }
      ).query;

      if (idOf(query["projectId"]) !== idOf(PROJECT_ID)) {
        return [];
      }

      return PROJECT_STATES.map(toModel);
    },
  );
}

/*
 * Every step of the chain onCreateSuccess starts is a stand-in that answers
 * at once, so the whole chain has run once the macrotask queue comes round.
 */
async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

interface Created {
  probes: Probes;
  carryForward: unknown;
  record: DatabaseBaseModel;
}

/*
 * Creates a record of `kind` through the service's own hooks, in `state`
 * (or with no state picked), with `policyIds` as its on-call policies, and
 * waits for the chain its success hook starts.
 */
interface CreateOptions {
  // More the write sends: a template, say.
  values?: Record<string, unknown> | undefined;
  miscDataProps?: JSONObject | undefined;
  // Stand-ins of the test's own, set up after the usual ones.
  extraStubs?: ((probes: Probes) => void) | undefined;
}

async function create(
  kind: Kind,
  state: string | null,
  policyIds: Array<string> = [PRIMARY_POLICY_ID],
  options: CreateOptions = {},
): Promise<Created> {
  const probes: Probes = newProbes();

  stubProjectDirectory({});
  stubStates(kind);
  kind.stubHooks(probes, policyIds);
  stub(CustomFieldMappingService, "applyMappingsToCreate");
  stub(UserService, "getUserMarkdownString", undefined, () => {
    return "**Ada**";
  });

  if (options.extraStubs) {
    options.extraStubs(probes);
  }

  const record: DatabaseBaseModel = kind.newRecord(policyIds);

  if (state) {
    (record as unknown as Record<string, unknown>)[kind.idColumn] =
      new ObjectID(state);
  }

  for (const [key, value] of Object.entries(options.values || {})) {
    (record as unknown as Record<string, unknown>)[key] = value;
  }

  const hooks: Record<string, AnyFunction> = kind.service as Record<
    string,
    AnyFunction
  >;

  const onCreate: { createBy: unknown; carryForward: unknown } = (await hooks[
    "onBeforeCreate"
  ]!.call(kind.service, {
    data: record,
    props: { tenantId: PROJECT_ID },
    ...(options.miscDataProps ? { miscDataProps: options.miscDataProps } : {}),
  })) as { createBy: unknown; carryForward: unknown };

  // What the database hands back: the row as written, with its id.
  record._id = RECORD_ID.toString();
  (record as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;

  await hooks["onCreateSuccess"]!.call(
    kind.service,
    { createBy: onCreate.createBy, carryForward: onCreate.carryForward },
    record,
  );

  await settle();

  return { probes, carryForward: onCreate.carryForward, record };
}

// The feed items saying the record's on-call policies were not run.
function onCallNotRunLines(
  kind: Kind,
  probes: Probes,
): Array<Record<string, unknown>> {
  return probes.feed.filter((item: Record<string, unknown>): boolean => {
    return (
      item[kind.feedEventTypeKey] === kind.onCallPolicyEventType &&
      String(item["feedInfoInMarkdown"]).includes("No one was paged")
    );
  });
}

function chainErrors(): Array<unknown> {
  return jest.mocked(logger.error).mock.calls;
}

beforeEach(() => {
  stateReads = 0;
  stateListReads = 0;
  jest.mocked(logger.error).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "an $name created in the created state, or before acknowledged, sets off what it always has",
  (kind: Kind) => {
    test.each([
      ["no state picked (the default, and every record a monitor opens)", null],
      ["the created state picked on purpose", CREATED],
      ["a state of the project's own before acknowledged", INVESTIGATING],
    ] as Array<[string, string | null]>)(
      "%s: its on-call policies page, and everything a live record sets off runs",
      async (_name: string, state: string | null) => {
        const { probes, record } = await create(kind, state);

        expect(probes.paged).toHaveLength(1);
        expect(probes.paged[0]!.policyId).toBe(PRIMARY_POLICY_ID);
        expect(probes.warRoom).toHaveLength(1);
        expect(onCallNotRunLines(kind, probes)).toHaveLength(0);

        expect(probes.grouped).toHaveLength(kind.has.grouping ? 1 : 0);
        expect(probes.runbooks).toHaveLength(kind.has.runbooks ? 1 : 0);
        expect(probes.remediated).toHaveLength(kind.has.remediation ? 1 : 0);
        expect(probes.investigated).toHaveLength(
          kind.has.investigation ? 1 : 0,
        );
        expect(probes.investigationSkipped).toEqual([]);
        expect(probes.sla).toHaveLength(kind.has.sla ? 1 : 0);
        expect(probes.monitorStatus).toHaveLength(
          kind.has.monitorStatus ? 1 : 0,
        );
        expect(probes.monitoringPaused).toHaveLength(
          kind.has.monitorStatus ? 1 : 0,
        );

        expect(probes.firstRows).toEqual([state || CREATED]);
        expect(
          idOf((record as unknown as Record<string, unknown>)[kind.idColumn]),
        ).toBe(state || CREATED);
        expect(chainErrors()).toEqual([]);
      },
    );

    test("with no state picked, the project's states are read only for the created state", async () => {
      await create(kind, null);

      // The created-state lookup; nothing else asked where the record starts.
      expect(stateReads).toBe(1);
    });
  },
);

describe.each(KINDS)(
  "an $name created at or past the acknowledged state pages nobody",
  (kind: Kind) => {
    test.each([
      ["the acknowledged state", ACKNOWLEDGED],
      ["a state of the project's own after acknowledged", MONITORING],
      ["the resolved state", RESOLVED],
    ] as Array<[string, string]>)(
      "%s: no on-call policy runs",
      async (_name: string, state: string) => {
        const { probes } = await create(kind, state, [
          PRIMARY_POLICY_ID,
          DATABASE_POLICY_ID,
        ]);

        expect(probes.paged).toEqual([]);
        expect(probes.episodeUpdates).toEqual([]);
        expect(chainErrors()).toEqual([]);
      },
    );

    test("its feed says why nobody was paged, in one line naming its policies", async () => {
      const { probes } = await create(kind, ACKNOWLEDGED, [
        PRIMARY_POLICY_ID,
        DATABASE_POLICY_ID,
      ]);

      const lines: Array<Record<string, unknown>> = onCallNotRunLines(
        kind,
        probes,
      );

      expect(lines).toHaveLength(1);
      expect(lines[0]!["feedInfoInMarkdown"]).toBe(
        `📞 **No one was paged.** This ${kind.noun} was created already acknowledged, so its on-call policies **Primary** and **Database \\[team\\]** were not run.`,
      );
      expect(idOf(lines[0]!["projectId"])).toBe(idOf(PROJECT_ID));
    });

    test("created resolved, the line says resolved, and one policy is named alone", async () => {
      const { probes } = await create(kind, RESOLVED, [PRIMARY_POLICY_ID]);

      const lines: Array<Record<string, unknown>> = onCallNotRunLines(
        kind,
        probes,
      );

      expect(lines).toHaveLength(1);
      expect(lines[0]!["feedInfoInMarkdown"]).toBe(
        `📞 **No one was paged.** This ${kind.noun} was created already resolved, so its on-call policy **Primary** was not run.`,
      );
    });

    test("with no on-call policy, there is nobody it did not page: no line", async () => {
      const { probes } = await create(kind, ACKNOWLEDGED, []);

      expect(probes.paged).toEqual([]);
      expect(onCallNotRunLines(kind, probes)).toHaveLength(0);
      expect(chainErrors()).toEqual([]);
    });

    test("its rules, its first timeline row and its created feed entry still happen", async () => {
      const { probes } = await create(kind, RESOLVED);

      expect(probes.privacyRules).toHaveLength(1);
      expect(probes.ownerRules).toHaveLength(1);
      expect(probes.labelRules).toHaveLength(1);
      expect(probes.onCallRules).toHaveLength(1);
      expect(probes.createdFeed).toHaveLength(1);
      expect(probes.firstRows).toEqual([RESOLVED]);
      expect(probes.reminders).toHaveLength(kind.has.reminders ? 1 : 0);
    });
  },
);

describe.each(KINDS)(
  "an $name created acknowledged is still live: only paging stops",
  (kind: Kind) => {
    test.each([
      ["the acknowledged state", ACKNOWLEDGED],
      ["a state of the project's own after acknowledged", MONITORING],
    ] as Array<[string, string]>)(
      "%s: its war-room channel, grouping, runbooks, remediation and AI still run",
      async (_name: string, state: string) => {
        const { probes } = await create(kind, state);

        expect(probes.warRoom).toHaveLength(1);
        expect(probes.grouped).toHaveLength(kind.has.grouping ? 1 : 0);
        expect(probes.runbooks).toHaveLength(kind.has.runbooks ? 1 : 0);
        expect(probes.remediated).toHaveLength(kind.has.remediation ? 1 : 0);
        expect(probes.investigated).toHaveLength(
          kind.has.investigation ? 1 : 0,
        );
        expect(probes.investigationSkipped).toEqual([]);
        expect(probes.monitorStatus).toHaveLength(
          kind.has.monitorStatus ? 1 : 0,
        );
        expect(probes.monitoringPaused).toHaveLength(
          kind.has.monitorStatus ? 1 : 0,
        );
        expect(chainErrors()).toEqual([]);
      },
    );
  },
);

describe.each(KINDS)(
  "an $name created resolved is over: nothing responds to it",
  (kind: Kind) => {
    test("no war-room channel is opened for it", async () => {
      const { probes } = await create(kind, RESOLVED);

      expect(probes.warRoom).toEqual([]);
      expect(chainErrors()).toEqual([]);
    });

    if (kind.has.grouping) {
      test("it is not grouped into an episode, which would page again", async () => {
        const { probes } = await create(kind, RESOLVED);

        expect(probes.grouped).toEqual([]);
      });
    }

    if (kind.has.runbooks) {
      test("no runbook rule starts a runbook for it", async () => {
        const { probes } = await create(kind, RESOLVED);

        expect(probes.runbooks).toEqual([]);
      });
    }

    if (kind.has.remediation) {
      test("auto-remediation does not act on it", async () => {
        const { probes } = await create(kind, RESOLVED);

        expect(probes.remediated).toEqual([]);
      });
    }

    if (kind.has.investigation) {
      test("no AI investigation is queued, and its AI card is told why", async () => {
        const { probes } = await create(kind, RESOLVED);

        expect(probes.investigated).toEqual([]);
        expect(probes.investigationSkipped).toEqual(["created_resolved"]);
      });
    }
  },
);

describe("an incident created resolved leaves its monitors and SLA alone", () => {
  test("its monitors keep their status and their monitoring", async () => {
    const { probes } = await create(INCIDENT, RESOLVED);

    expect(probes.monitorStatus).toEqual([]);
    expect(probes.monitoringPaused).toEqual([]);
  });

  test("no SLA is started for it: there is nothing left to respond to or resolve in time", async () => {
    const { probes } = await create(INCIDENT, RESOLVED);

    expect(probes.sla).toEqual([]);
  });

  test("an incident created acknowledged starts its SLA already responded to, the moment it was declared", async () => {
    const { probes, record } = await create(INCIDENT, ACKNOWLEDGED);

    expect(probes.sla).toHaveLength(1);
    const declaredAt: Date = (record as Incident).declaredAt as Date;
    expect(declaredAt).toBeInstanceOf(Date);
    expect(probes.sla[0]!["respondedAt"]).toEqual(declaredAt);
  });

  test("an incident created in the created state starts its SLA with no response yet", async () => {
    const { probes } = await create(INCIDENT, null);

    expect(probes.sla).toHaveLength(1);
    expect(probes.sla[0]!["respondedAt"]).toBeUndefined();
  });

  test("the policies an on-call rule attaches do not page either, and the line names them too", async () => {
    const { probes } = await createWithOnCallRule(INCIDENT, MONITORING);

    expect(probes.onCallRules).toHaveLength(1);
    expect(probes.paged).toEqual([]);
    const lines: Array<Record<string, unknown>> = onCallNotRunLines(
      INCIDENT,
      probes,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!["feedInfoInMarkdown"]).toContain(
      "**Primary** and **Database \\[team\\]** were not run",
    );
  });
});

/*
 * Like create, with an on-call rule that attaches the Database policy to the
 * record in memory, as the rule engines do before the fan-out.
 */
async function createWithOnCallRule(
  kind: Kind,
  state: string,
): Promise<Created> {
  const original: Kind["stubHooks"] = kind.stubHooks;

  const withRule: Kind = {
    ...kind,
    stubHooks: (probes: Probes, policyIds: Array<string>): void => {
      original(probes, policyIds);
      jest
        .spyOn(
          IncidentOnCallRuleEngineService as unknown as Record<
            string,
            AnyFunction
          >,
          "applyRulesToIncident",
        )
        .mockImplementation((async (incident: unknown): Promise<void> => {
          const model: Incident = incident as Incident;
          probes.onCallRules.push(model);
          model.onCallDutyPolicies = [
            ...(model.onCallDutyPolicies || []),
            ...policyStubs([DATABASE_POLICY_ID]),
          ];
        }) as never);
    },
  };

  return create(withRule, state, [PRIMARY_POLICY_ID]);
}

describe("the on-call policies a live record pages are told what paged them", () => {
  test.each([
    [
      INCIDENT,
      UserNotificationEventType.IncidentCreated,
      "triggeredByIncidentId",
    ],
    [ALERT, UserNotificationEventType.AlertCreated, "triggeredByAlertId"],
    [
      ALERT_EPISODE,
      UserNotificationEventType.AlertEpisodeCreated,
      "triggeredByAlertEpisodeId",
    ],
    [
      INCIDENT_EPISODE,
      UserNotificationEventType.IncidentEpisodeCreated,
      "triggeredByIncidentEpisodeId",
    ],
  ] as Array<[Kind, UserNotificationEventType, string]>)(
    "%#: unchanged for a record created in the created state",
    async (
      kind: Kind,
      eventType: UserNotificationEventType,
      triggerKey: string,
    ) => {
      const { probes } = await create(kind, null);

      expect(probes.paged).toHaveLength(1);
      expect(probes.paged[0]!.options["userNotificationEventType"]).toBe(
        eventType,
      );
      expect(idOf(probes.paged[0]!.options[triggerKey])).toBe(idOf(RECORD_ID));
    },
  );
});

/*
 * Where the record starts is read once, in onBeforeCreate, and handed to
 * onCreateSuccess, which decides on it: no second read after the record is
 * written, and none at all for a record that starts in the created state.
 */
describe.each(KINDS)(
  "an $name: where it starts is read once and handed on",
  (kind: Kind) => {
    test.each([
      ["no state picked", null, StartingStage.Open],
      ["the created state", CREATED, StartingStage.Open],
      ["a state before acknowledged", INVESTIGATING, StartingStage.Open],
      ["the acknowledged state", ACKNOWLEDGED, StartingStage.Acknowledged],
      ["a state after acknowledged", MONITORING, StartingStage.Acknowledged],
      ["the resolved state", RESOLVED, StartingStage.Resolved],
    ] as Array<[string, string | null, StartingStage]>)(
      "%s: handed on as %s",
      async (_name: string, state: string | null, expected: StartingStage) => {
        const { carryForward } = await create(kind, state);

        expect(
          (carryForward as { startingStage: StartingStage }).startingStage,
        ).toBe(expected);
      },
    );

    test("a picked state is placed with one read of the project's whole list", async () => {
      await create(kind, RESOLVED);

      expect(stateListReads).toBe(1);
    });

    test("no state picked: the list is never read", async () => {
      await create(kind, null);

      expect(stateListReads).toBe(0);
    });
  },
);

describe.each(KINDS)(
  "an $name: the line that says nobody was paged",
  (kind: Kind) => {
    test("is an on-call entry of the record's own feed, in grey, and is not posted to Slack or Microsoft Teams", async () => {
      const { probes } = await create(kind, MONITORING);

      const lines: Array<Record<string, unknown>> = onCallNotRunLines(
        kind,
        probes,
      );

      expect(lines).toHaveLength(1);
      expect(lines[0]![kind.feedEventTypeKey]).toBe(kind.onCallPolicyEventType);
      expect(lines[0]!["displayColor"]).toBe(Gray500);
      expect(lines[0]!["workspaceNotification"]).toBeUndefined();
      expect(idOf(lines[0]![kind.feedRecordKey])).toBe(idOf(RECORD_ID));
    });

    test("is written once, however many policies it names", async () => {
      const { probes } = await create(kind, RESOLVED, [
        PRIMARY_POLICY_ID,
        DATABASE_POLICY_ID,
        PRIMARY_POLICY_ID,
      ]);

      expect(onCallNotRunLines(kind, probes)).toHaveLength(1);
      expect(
        String(onCallNotRunLines(kind, probes)[0]!["feedInfoInMarkdown"]),
      ).toContain("**Primary** and **Database \\[team\\]** were not run");
    });
  },
);

describe("an incident or alert created resolved tells its AI card why it was not investigated", () => {
  test.each([
    [INCIDENT, "incidentId"],
    [ALERT, "alertId"],
  ] as Array<[Kind, string]>)(
    "%#: the decision is recorded for this record of this project",
    async (kind: Kind, subjectKey: string) => {
      const subjects: Array<Record<string, unknown>> = [];

      await create(kind, RESOLVED, [PRIMARY_POLICY_ID], {
        extraStubs: () => {
          jest
            .spyOn(InvestigationEligibility, "recordSkipped")
            .mockImplementation((async (
              subject: Record<string, unknown>,
              code: string,
            ): Promise<void> => {
              subjects.push({ ...subject, code: code });
            }) as never);
        },
      });

      expect(subjects).toHaveLength(1);
      expect(subjects[0]!["code"]).toBe("created_resolved");
      expect(idOf(subjects[0]![subjectKey])).toBe(idOf(RECORD_ID));
      expect(idOf(subjects[0]!["projectId"])).toBe(idOf(PROJECT_ID));
    },
  );
});

describe("an incident declared from a template that starts it acknowledged or resolved", () => {
  const TEMPLATE_ID: string = "0193c0de-5a7e-4ccc-8ddd-0000000000c7";

  function fromTemplateStarting(state: string): CreateOptions {
    return {
      values: { createdIncidentTemplateId: new ObjectID(TEMPLATE_ID) },
      extraStubs: () => {
        stub(IncidentTemplateService, "findOneBy", undefined, () => {
          const template: IncidentTemplate = new IncidentTemplate();
          template._id = TEMPLATE_ID;
          template.initialIncidentStateId = new ObjectID(state);
          return template;
        });
      },
    };
  }

  test("starts in the template's state", async () => {
    const { record, carryForward } = await create(
      INCIDENT,
      null,
      [PRIMARY_POLICY_ID],
      fromTemplateStarting(ACKNOWLEDGED),
    );

    expect(idOf((record as Incident).currentIncidentStateId)).toBe(
      ACKNOWLEDGED,
    );
    expect(
      (carryForward as { startingStage: StartingStage }).startingStage,
    ).toBe(StartingStage.Acknowledged);
  });

  test("acknowledged: pages nobody, and says so", async () => {
    const { probes } = await create(
      INCIDENT,
      null,
      [PRIMARY_POLICY_ID],
      fromTemplateStarting(ACKNOWLEDGED),
    );

    expect(probes.paged).toEqual([]);
    expect(onCallNotRunLines(INCIDENT, probes)).toHaveLength(1);
    expect(probes.grouped).toHaveLength(1);
  });

  test("resolved: nothing answers it", async () => {
    const { probes } = await create(
      INCIDENT,
      null,
      [PRIMARY_POLICY_ID],
      fromTemplateStarting(RESOLVED),
    );

    expect(probes.paged).toEqual([]);
    expect(probes.warRoom).toEqual([]);
    expect(probes.grouped).toEqual([]);
    expect(probes.runbooks).toEqual([]);
    expect(probes.remediated).toEqual([]);
    expect(probes.investigated).toEqual([]);
    expect(probes.sla).toEqual([]);
    expect(probes.monitorStatus).toEqual([]);
    expect(probes.monitoringPaused).toEqual([]);
    expect(chainErrors()).toEqual([]);
  });
});

describe("an incident declared resolved from alerts still links and announces them", () => {
  const ALERT_A: string = "0193c0de-5a7e-4ccc-8ddd-0000000000aa";
  const ALERT_B: string = "0193c0de-5a7e-4ccc-8ddd-0000000000ab";

  test("the alerts are linked and announced, and nobody is paged", async () => {
    const linked: Array<Record<string, unknown>> = [];
    const announced: Array<Record<string, unknown>> = [];

    const { probes, carryForward } = await create(
      INCIDENT,
      RESOLVED,
      [PRIMARY_POLICY_ID],
      {
        miscDataProps: { [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_A, ALERT_B] },
        extraStubs: () => {
          stub(
            IncidentAlertService,
            "validateAlertIdsForNewIncident",
            undefined,
            () => {
              return [new ObjectID(ALERT_A), new ObjectID(ALERT_B)];
            },
          );
          stub(
            IncidentAlertService,
            "linkAlertsToIncident",
            (args: Array<unknown>) => {
              linked.push(args[0] as Record<string, unknown>);
            },
            () => {
              return {
                linkedAlertIds: [new ObjectID(ALERT_A), new ObjectID(ALERT_B)],
                alreadyLinkedAlertIds: [],
                failed: [],
              };
            },
          );
          stub(
            IncidentAlertService,
            "createDeclaredFromAlertsFeedItem",
            (args: Array<unknown>) => {
              announced.push(args[0] as Record<string, unknown>);
            },
          );
        },
      },
    );

    expect(carryForward).toEqual(
      expect.objectContaining({
        startingStage: StartingStage.Resolved,
        alertIdsToLink: [new ObjectID(ALERT_A), new ObjectID(ALERT_B)],
      }),
    );
    expect(linked).toHaveLength(1);
    expect(
      (linked[0]!["alertIds"] as Array<ObjectID>).map(idOf).sort(),
    ).toEqual([ALERT_A, ALERT_B].sort());
    expect(announced).toHaveLength(1);
    expect(probes.paged).toEqual([]);
    expect(probes.grouped).toEqual([]);
  });
});

describe("a live record still pages every policy, its rules' included", () => {
  test.each([
    ["the created state", CREATED],
    ["a state before acknowledged", INVESTIGATING],
  ] as Array<[string, string]>)(
    "an incident in %s pages the policy it named and the one a rule attached",
    async (_name: string, state: string) => {
      const { probes } = await createWithOnCallRule(INCIDENT, state);

      expect(
        probes.paged
          .map((page: { policyId: string }): string => {
            return page.policyId;
          })
          .sort(),
      ).toEqual([PRIMARY_POLICY_ID, DATABASE_POLICY_ID].sort());
      expect(onCallNotRunLines(INCIDENT, probes)).toHaveLength(0);
    },
  );
});
