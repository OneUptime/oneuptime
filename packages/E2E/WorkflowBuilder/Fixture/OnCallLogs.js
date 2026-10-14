/*
 * The Dashboard's on-call logs with a direct page in them - people paged by
 * a workflow's Page Users, Page a Team or Page Whoever Is On Call step, with
 * no on-call policy behind the page.
 *
 * ?page=on-call-logs      On-Call Duty > Execution Logs: the REAL table
 *                         (ExecutionLogsTable), listing two policies' runs
 *                         - one of a policy with a very long name - and
 *                         four direct pages: one started by a workflow with
 *                         a very long name, one by a person, one that paged
 *                         nobody, and one with nothing else known
 * ?page=on-call-timeline  one run's timeline: the REAL table
 *                         (ExecutionLogsTimelineTable) of a direct page -
 *                         two people paged, a schedule with nobody on call,
 *                         and a team with no members
 *
 * Nothing of the tables is faked: the columns, the cells' wrapping, the
 * phone layout and the card are the Dashboard's own. Only the API is stood
 * in for (installOnCallLogs): it answers each list with the rows below, and
 * notes what it was asked for in window.__listRequests.
 *
 * The page gives the table the width its card has in the Dashboard on a
 * laptop - beside the side menu, inside the page's gutters - because how
 * much room the columns have is what the specs are about.
 */
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import React from "react";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import ExecutionLogsTable from "../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import ExecutionLogTimelineTable from "../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";

export const ON_CALL_LOGS_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
export const PAGING_WORKFLOW_ID = "44444444-4444-4444-8444-444444444444";
export const DIRECT_PAGE_RUN_ID = "0193c0de-1111-4aaa-8bbb-000000000001";

// A name nobody would call short: it has to wrap, and not widen the table.
export const LONG_WORKFLOW_NAME =
  "Page whoever is on call for critical incidents in the payments platform (EU and US regions)";

// A policy can be named at as much length, and has no label to wrap it.
export const LONG_POLICY_NAME =
  "Payments platform critical escalation for the EU and US regions (primary on call, then secondary, then engineering managers)";

const NOW = Date.parse("2026-10-13T16:20:00Z");

function person(id, name, email) {
  const user = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

const JANE = person(
  "10000000-0000-4000-8000-000000000001",
  "Jane Doe",
  "jane@example.com",
);
const ALEX = person(
  "10000000-0000-4000-8000-000000000003",
  "Alex Kim",
  "alex@example.com",
);

function policy(name, number) {
  const model = new OnCallDutyPolicy();
  model._id = `dddddddd-0000-4000-8000-00000000000${number}`;
  model.name = name;
  return model;
}

function incident(title) {
  const model = new Incident();
  model._id = "1c1d0000-0000-4000-8000-000000000008";
  model.title = title;
  return model;
}

function alert(title, number) {
  const model = new Alert();
  model._id = `a1e70000-0000-4000-8000-00000000000${number}`;
  model.title = title;
  return model;
}

function run(data) {
  const model = new OnCallDutyPolicyExecutionLog();
  model._id = data.id;
  model.projectId = new ObjectID(ON_CALL_LOGS_PROJECT_ID);

  if (data.policy) {
    model.onCallDutyPolicy = data.policy;
    model.onCallDutyPolicyId = new ObjectID(data.policy._id);
  }

  if (data.workflowName) {
    model.triggeredByWorkflowName = data.workflowName;
    model.triggeredByWorkflowId = new ObjectID(PAGING_WORKFLOW_ID);
  }

  if (data.startedBy) {
    model.triggeredByUser = data.startedBy;
  }

  if (data.incident) {
    model.triggeredByIncident = data.incident;
  }

  if (data.alert) {
    model.triggeredByAlert = data.alert;
  }

  model.status = data.status;
  model.statusMessage = data.statusMessage;
  model.createdAt = new Date(NOW - data.minutesAgo * 60000);

  if (data.acknowledgedBy) {
    model.acknowledgedByUser = data.acknowledgedBy;
  }

  return model;
}

const RUNS = [
  run({
    id: DIRECT_PAGE_RUN_ID,
    workflowName: "Page the on-call engineer",
    incident: incident("Checkout is down"),
    status: OnCallDutyPolicyStatus.Executing,
    statusMessage: "2 people were paged.",
    minutesAgo: 3,
  }),
  run({
    id: "0193c0de-2222-4aaa-8bbb-000000000002",
    policy: policy("Critical", 1),
    incident: incident("Checkout is down"),
    status: OnCallDutyPolicyStatus.Completed,
    statusMessage: "Execution completed.",
    minutesAgo: 4,
    acknowledgedBy: JANE,
  }),
  run({
    id: "0193c0de-3333-4aaa-8bbb-000000000003",
    workflowName: LONG_WORKFLOW_NAME,
    alert: alert("Database CPU is above 90%", 2),
    status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
    statusMessage: "Nobody was paged.",
    minutesAgo: 58,
  }),
  run({
    id: "0193c0de-4444-4aaa-8bbb-000000000004",
    startedBy: ALEX,
    alert: alert("Disk is full", 1),
    status: OnCallDutyPolicyStatus.Completed,
    statusMessage: "1 person was paged.",
    minutesAgo: 190,
    acknowledgedBy: JANE,
  }),
  run({
    id: "0193c0de-5555-4aaa-8bbb-000000000005",
    alert: alert("Queue depth is growing", 3),
    status: OnCallDutyPolicyStatus.Error,
    statusMessage: "Paging timed out.",
    minutesAgo: 1500,
  }),
  run({
    id: "0193c0de-6666-4aaa-8bbb-000000000006",
    policy: policy(LONG_POLICY_NAME, 2),
    incident: incident("Checkout is down"),
    status: OnCallDutyPolicyStatus.Completed,
    statusMessage: "Execution completed.",
    minutesAgo: 2900,
    acknowledgedBy: ALEX,
  }),
];

function step(data) {
  const model = new OnCallDutyPolicyExecutionLogTimeline();
  model._id = `71e10000-0000-4000-8000-00000000000${data.id}`;
  model.projectId = new ObjectID(ON_CALL_LOGS_PROJECT_ID);

  if (data.user) {
    model.alertSentToUser = data.user;
  }

  if (data.scheduleName) {
    const schedule = new OnCallDutyPolicySchedule();
    schedule._id = "5c4e0000-0000-4000-8000-000000000001";
    schedule.name = data.scheduleName;
    model.onCallDutySchedule = schedule;
    model.onCallDutyScheduleId = new ObjectID(schedule._id);
  }

  if (data.teamName) {
    const team = new Team();
    team._id = "7eae0000-0000-4000-8000-000000000009";
    team.name = data.teamName;
    model.userBelongsToTeam = team;
    model.userBelongsToTeamId = new ObjectID(team._id);
  }

  model.status = data.status;
  model.statusMessage = data.statusMessage;
  model.createdAt = new Date(NOW - 3 * 60000);

  if (data.acknowledged) {
    model.acknowledgedAt = new Date(NOW - 60000);
  }

  return model;
}

// A direct page's timeline: no line of it names a policy or a rule.
const TIMELINE = [
  step({
    id: 1,
    user: JANE,
    teamName: "Platform",
    status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    statusMessage: "Successfully acknowledged.",
    acknowledged: true,
  }),
  step({
    id: 2,
    user: ALEX,
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    statusMessage: "Notification sent by SMS and email.",
  }),
  step({
    id: 3,
    scheduleName: "Secondary",
    status: OnCallDutyExecutionLogTimelineStatus.Skipped,
    statusMessage:
      "Skipped because no active users are found in this schedule.",
  }),
  step({
    id: 4,
    teamName: "Night Shift",
    status: OnCallDutyExecutionLogTimelineStatus.Skipped,
    statusMessage: "Skipped because this team has no members.",
  }),
];

function result(rows, data) {
  return { data: rows, count: rows.length, skip: 0, limit: data.limit };
}

/*
 * Stands in for the API and for who is signed in: somebody who may read
 * everything in the project.
 */
export function installOnCallLogs() {
  const held = Object.values(Permission);

  window.__listRequests = [];

  ProjectUtil.getCurrentProjectId = () => {
    return new ObjectID(ON_CALL_LOGS_PROJECT_ID);
  };

  PermissionUtil.getAllPermissions = () => {
    return held;
  };

  PermissionUtil.getProjectPermissions = () => {
    return {
      _type: "UserTenantAccessPermission",
      projectId: new ObjectID(ON_CALL_LOGS_PROJECT_ID),
      permissions: held.map((permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    };
  };

  PermissionUtil.getGlobalPermissions = () => {
    return {
      _type: "UserGlobalAccessPermission",
      projectIds: [new ObjectID(ON_CALL_LOGS_PROJECT_ID)],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    };
  };

  UserUtil.getUserId = () => {
    return new ObjectID(JANE._id);
  };

  UserUtil.isMasterAdmin = () => {
    return false;
  };

  ModelAPI.getList = async (data) => {
    window.__listRequests.push({
      model: new data.modelType().tableName,
      select: Object.keys(data.select || {}),
    });

    if (data.modelType === OnCallDutyPolicyExecutionLog) {
      return result(RUNS, data);
    }

    if (data.modelType === OnCallDutyPolicyExecutionLogTimeline) {
      return result(TIMELINE, data);
    }

    return result([], data);
  };

  ModelAPI.count = async () => {
    return 0;
  };
}

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return props.children;
}

/*
 * The width the table's card has in the Dashboard on a laptop: the page is
 * 80rem wide at most, with its gutters, and the side menu takes its share.
 * On a phone the card is as wide as the screen allows.
 */
const CARD_WIDTH = "55rem";

function Frame(props) {
  return (
    <BrowserRouter>
      <Shell>
        <div
          data-testid="on-call-logs-page"
          style={{ padding: "16px", maxWidth: CARD_WIDTH }}
        >
          {props.children}
        </div>
      </Shell>
    </BrowserRouter>
  );
}

export function OnCallLogsPage() {
  return (
    <Frame>
      <ExecutionLogsTable />
    </Frame>
  );
}

export function OnCallTimelinePage() {
  return (
    <Frame>
      <ExecutionLogTimelineTable
        onCallPolicyExecutionLogId={new ObjectID(DIRECT_PAGE_RUN_ID)}
      />
    </Frame>
  );
}
