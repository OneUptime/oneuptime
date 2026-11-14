/*
 * MonitorIncident and MonitorAlert render titles through MonitorTemplateUtil,
 * which pulls the native isolated-vm addon in through VMAPI. Nothing here
 * runs the sandbox, and the prebuilt binary cannot always load in the test
 * environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import Project from "../../../Models/DatabaseModels/Project";
import ServiceOwnerUser from "../../../Models/DatabaseModels/ServiceOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerRuleService from "../../../Server/Services/IncidentOwnerRuleService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceOwnerUserService from "../../../Server/Services/NetworkDeviceOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../Server/Services/ServiceOwnerUserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DataAlertCause from "../../../Server/Utils/DataObservability/DataAlertCause";
import logger from "../../../Server/Utils/Logger";
import MonitorAlert from "../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../Server/Utils/Monitor/MonitorResourceContext";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import IncidentStatusPageScope from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  WhoIsToldEvent,
  WhoIsToldOwnersSource,
  WhoIsToldResult,
  WhoIsToldRule,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHO "WHEN THIS GOES DOWN" SAYS IS EMAILED IS WHO A REAL INCIDENT'S OWNERS
 * ARE (#7076).
 *
 * The card (WhoIsToldService) names the owners of what a monitor's criteria
 * opens: whom the criteria names, the owners of the network device the
 * monitor watches, and whom the project's owner rules add - by the owner
 * rule engines' own plan of the incident or alert held in memory, with the
 * title it would get. A real one is made by MonitorIncident (MonitorAlert)
 * from the same criteria, which adds the criteria's and the device's owners,
 * and the create's chain applies the project's owner rules to it
 * (applyRulesToIncident, applyRulesToAlert). Its "created" email goes to
 * every owner it then has, or to the project's owners when it has none.
 *
 * Over generated monitors, criteria and rules - severities, monitors,
 * labels of the record and of the monitor, title and monitor name patterns,
 * named owners, Notify Owners, owners inherited from the monitor and from a
 * service it is linked to - drawn from a seed so a failure can be run
 * again, the owners the card names are exactly the owners the real record
 * gets, and both are what a plain reading of the rules says. Only what a
 * title can say before a check is drawn ({{monitorName}}, {{monitorType}}):
 * what a check reports is not known before one.
 *
 * And only the owners the "created" email reaches (#7211): the owners are
 * drawn from people who left the project or never accepted its invitation
 * too, and from a team with nobody in it and one with only an invitation
 * nobody accepted. The real record gets its owner rows through the real
 * OwnerRuleAssignment (which refuses a person who is not a member), and
 * whom its email reaches is read by its real findOwners (a team through its
 * members, everyone who is not a member left out) - or, nobody, the
 * project's owners, as the email job does. The card names exactly the
 * people and teams of those, and the people they reach are the people the
 * email reaches, one by one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "70760000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "70760000-0000-4000-8000-000000000002";
const OTHER_MONITOR: string = "70760000-0000-4000-8000-000000000003";
const STEP_ID: string = "70760000-0000-4000-8000-000000000004";
const SERVICE: string = "70760000-0000-4000-8000-000000000005";

const SEVERITIES: Array<string> = [
  "70760000-0000-4000-8000-0000000000b1",
  "70760000-0000-4000-8000-0000000000b2",
];
const MONITOR_LABELS: Array<string> = [
  "70760000-0000-4000-8000-0000000000c1",
  "70760000-0000-4000-8000-0000000000c2",
];
const RECORD_LABELS: Array<string> = [
  "70760000-0000-4000-8000-0000000000d1",
  "70760000-0000-4000-8000-0000000000d2",
];
const USERS: Array<string> = [
  "70760000-0000-4000-8000-0000000000e1",
  "70760000-0000-4000-8000-0000000000e2",
  "70760000-0000-4000-8000-0000000000e3",
  "70760000-0000-4000-8000-0000000000e4",
];
const TEAMS: Array<string> = [
  "70760000-0000-4000-8000-0000000000f1",
  "70760000-0000-4000-8000-0000000000f2",
];

/*
 * WHO IS IN THE PROJECT, AND IN ITS TEAMS (#7211). Every person of USERS
 * is a member: an accepted invitation to its Members team. DEPARTED left
 * the project, and has no row any more; PENDING was invited and never
 * accepted. EMPTY_TEAM has nobody in it, and PENDING_TEAM only PENDING's
 * invitation: an email reaches nobody through either. TEAMS[1] also holds
 * an invitation of USERS[0] not accepted yet - a member through the Members
 * team, whom the email counts all the same (getUsersInTeams reads pending
 * invitations too).
 */
const DEPARTED: string = "70760000-0000-4000-8000-0000000000e9";
const PENDING: string = "70760000-0000-4000-8000-0000000000ea";
const MEMBERS_TEAM: string = "70760000-0000-4000-8000-0000000000f0";
const EMPTY_TEAM: string = "70760000-0000-4000-8000-0000000000f9";
const PENDING_TEAM: string = "70760000-0000-4000-8000-0000000000fa";

interface TeamRow {
  teamId: string;
  userId: string;
  isAccepted: boolean;
}

const TEAM_ROWS: Array<TeamRow> = [
  ...USERS.map((userId: string): TeamRow => {
    return { teamId: MEMBERS_TEAM, userId: userId, isAccepted: true };
  }),
  { teamId: TEAMS[0]!, userId: USERS[2]!, isAccepted: true },
  { teamId: TEAMS[1]!, userId: USERS[3]!, isAccepted: true },
  { teamId: TEAMS[1]!, userId: USERS[0]!, isAccepted: false },
  { teamId: PENDING_TEAM, userId: PENDING, isAccepted: false },
];

// The owners drawn: the project's, and those its email does not reach.
const OWNER_USERS: Array<string> = [...USERS, DEPARTED, PENDING];
const OWNER_TEAMS: Array<string> = [...TEAMS, EMPTY_TEAM, PENDING_TEAM];

// A plain reading of the same: the project's members, and who is in each team.
const PROJECT_MEMBERS: Array<string> = [...USERS];
const TEAM_PEOPLE: Record<string, Array<string>> = {
  [TEAMS[0]!]: [USERS[2]!],
  [TEAMS[1]!]: [USERS[3]!, USERS[0]!],
  [EMPTY_TEAM]: [],
  [PENDING_TEAM]: [PENDING],
};

const MONITOR_NAMES: Array<string> = ["Checkout API", "Search API"];
const TITLE_TEMPLATES: Array<string> = [
  "{{monitorName}} is offline",
  "Checkout is down",
  "{{monitorName}} ({{monitorType}}) failed",
];
const TITLE_PATTERNS: Array<string> = [
  "^Checkout",
  "offline$",
  // Only the template as written says this.
  "monitorName",
  "\\(Website\\)",
  "^Search API is offline$",
];
const NAME_PATTERNS: Array<string> = ["^Checkout", "API$", "^Search"];

const PROJECT_OWNERS: string = "the project's owners";

const CASES: number = 120;

// A generated owner rule, as plain facts.
interface RuleFacts {
  severities: Array<string>;
  monitors: Array<string>;
  labels: Array<string>;
  monitorLabels: Array<string>;
  titlePattern: string | null;
  namePattern: string | null;
  users: Array<string>;
  teams: Array<string>;
  notifyOwners: boolean;
  inheritsFromMonitors: boolean;
  inheritsFromServices: boolean;
}

// A generated monitor, its criteria, and what is around them.
interface CaseFacts {
  monitorName: string;
  monitorLabels: Array<string>;
  titleTemplate: string;
  severity: string;
  labels: Array<string>;
  criteriaUsers: Array<string>;
  criteriaTeams: Array<string>;
  deviceUsers: Array<string>;
  monitorOwners: Array<string>;
  isLinkedToService: boolean;
  serviceOwners: Array<string>;
  rules: Array<RuleFacts>;
}

// Who is emailed: owners by id, sorted, or the project's owners.
type Emailed = { users: Array<string>; teams: Array<string> } | string;

// Whom that email reaches, one by one: people by id, sorted, or the project's owners.
type Reached = Array<string> | string;

function pick<T>(items: Array<T>, random: SeededRandom): T {
  return items[random(items.length)]!;
}

// None of them half the time; otherwise one or two.
function someOf(items: Array<string>, random: SeededRandom): Array<string> {
  if (random(2) === 0) {
    return [];
  }

  const chosen: Array<string> = [pick(items, random)];

  if (random(2) === 0) {
    const second: string = pick(items, random);

    if (!chosen.includes(second)) {
      chosen.push(second);
    }
  }

  return chosen;
}

// One in `odds` times, some of them; else none.
function rarelySomeOf(
  items: Array<string>,
  odds: number,
  random: SeededRandom,
): Array<string> {
  return random(odds) === 0 ? [pick(items, random)] : [];
}

function generateRule(random: SeededRandom): RuleFacts {
  return {
    severities: rarelySomeOf(SEVERITIES, 3, random),
    monitors: rarelySomeOf([MONITOR_ID, OTHER_MONITOR], 4, random),
    labels: rarelySomeOf(RECORD_LABELS, 3, random),
    monitorLabels: rarelySomeOf(MONITOR_LABELS, 4, random),
    titlePattern: random(3) === 0 ? pick(TITLE_PATTERNS, random) : null,
    namePattern: random(4) === 0 ? pick(NAME_PATTERNS, random) : null,
    users: someOf(OWNER_USERS, random),
    teams: rarelySomeOf(OWNER_TEAMS, 3, random),
    notifyOwners: random(2) === 0,
    inheritsFromMonitors: random(4) === 0,
    inheritsFromServices: random(4) === 0,
  };
}

function generateCase(random: SeededRandom): CaseFacts {
  const rules: Array<RuleFacts> = [];
  const ruleCount: number = random(4);

  for (let index: number = 0; index < ruleCount; index++) {
    rules.push(generateRule(random));
  }

  return {
    monitorName: pick(MONITOR_NAMES, random),
    monitorLabels: someOf(MONITOR_LABELS, random),
    titleTemplate: pick(TITLE_TEMPLATES, random),
    severity: pick(SEVERITIES, random),
    labels: someOf(RECORD_LABELS, random),
    criteriaUsers: rarelySomeOf(OWNER_USERS, 3, random),
    criteriaTeams: rarelySomeOf(OWNER_TEAMS, 4, random),
    deviceUsers: rarelySomeOf(OWNER_USERS, 5, random),
    monitorOwners: someOf(OWNER_USERS, random),
    isLinkedToService: random(2) === 0,
    serviceOwners: someOf(OWNER_USERS, random),
    rules: rules,
  };
}

// The title the record gets: what is known of the monitor before a check put in.
function renderedTitle(facts: CaseFacts): string {
  return facts.titleTemplate
    .split("{{monitorName}}")
    .join(facts.monitorName)
    .split("{{monitorType}}")
    .join(MonitorType.Website);
}

// A plain reading of a rule: every filter it sets holds.
function oracleMatches(rule: RuleFacts, facts: CaseFacts): boolean {
  if (rule.severities.length > 0 && !rule.severities.includes(facts.severity)) {
    return false;
  }

  if (rule.monitors.length > 0 && !rule.monitors.includes(MONITOR_ID)) {
    return false;
  }

  const overlaps: (wanted: Array<string>, had: Array<string>) => boolean = (
    wanted: Array<string>,
    had: Array<string>,
  ): boolean => {
    return (
      wanted.length === 0 ||
      wanted.some((id: string): boolean => {
        return had.includes(id);
      })
    );
  };

  if (
    !overlaps(rule.labels, facts.labels) ||
    !overlaps(rule.monitorLabels, facts.monitorLabels)
  ) {
    return false;
  }

  if (
    rule.namePattern &&
    !new RegExp(rule.namePattern).test(facts.monitorName)
  ) {
    return false;
  }

  if (
    rule.titlePattern &&
    !new RegExp(rule.titlePattern).test(renderedTitle(facts))
  ) {
    return false;
  }

  return true;
}

// Who a matched rule brings: whom it names, and whom it inherits.
function oracleRuleOwners(
  rule: RuleFacts,
  facts: CaseFacts,
): { users: Array<string>; teams: Array<string> } {
  const users: Array<string> = [...rule.users];

  if (rule.inheritsFromMonitors) {
    users.push(...facts.monitorOwners);
  }

  if (rule.inheritsFromServices && facts.isLinkedToService) {
    users.push(...facts.serviceOwners);
  }

  return { users: users, teams: [...rule.teams] };
}

function sortedUnique(ids: Array<string>): Array<string> {
  return Array.from(new Set<string>(ids)).sort();
}

// A member of the project: an email reaches them.
function isMember(userId: string): boolean {
  return PROJECT_MEMBERS.includes(userId);
}

// A team an email reaches somebody through: one of its people is a member.
function teamReaches(teamId: string): boolean {
  return (TEAM_PEOPLE[teamId] || []).some(isMember);
}

// Everyone the criteria, the device and the matching rules name.
function oracleOwners(facts: CaseFacts): {
  users: Array<string>;
  teams: Array<string>;
} {
  const users: Array<string> = [...facts.criteriaUsers, ...facts.deviceUsers];
  const teams: Array<string> = [...facts.criteriaTeams];

  for (const rule of facts.rules) {
    if (oracleMatches(rule, facts)) {
      const owners: { users: Array<string>; teams: Array<string> } =
        oracleRuleOwners(rule, facts);
      users.push(...owners.users);
      teams.push(...owners.teams);
    }
  }

  return { users: users, teams: teams };
}

// Of those, the owners the "created" email reaches - or, none, the project's owners.
function oracleEmailed(facts: CaseFacts): Emailed {
  const owners: { users: Array<string>; teams: Array<string> } =
    oracleOwners(facts);
  const users: Array<string> = owners.users.filter(isMember);
  const teams: Array<string> = owners.teams.filter(teamReaches);

  if (users.length === 0 && teams.length === 0) {
    return PROJECT_OWNERS;
  }

  return { users: sortedUnique(users), teams: sortedUnique(teams) };
}

// Whom an email to these owners reaches: each person, and each member of each team.
function reachedBy(emailed: Emailed): Reached {
  if (typeof emailed === "string") {
    return emailed;
  }

  return sortedUnique([
    ...emailed.users.filter(isMember),
    ...emailed.teams.flatMap((teamId: string): Array<string> => {
      return (TEAM_PEOPLE[teamId] || []).filter(isMember);
    }),
  ]);
}

/*
 * The owner rows the real record gets: every member named - nobody who is
 * not one is ever made an owner - and every team named, even one the email
 * reaches nobody through.
 */
function oracleOwnerRows(facts: CaseFacts): {
  users: Array<string>;
  teams: Array<string>;
} {
  const owners: { users: Array<string>; teams: Array<string> } =
    oracleOwners(facts);

  return {
    users: sortedUnique(owners.users.filter(isMember)),
    teams: sortedUnique(owners.teams),
  };
}

// The rules the card says add owners: those that match and bring somebody the email reaches.
function oracleOwnerRules(facts: CaseFacts): Array<string> {
  return facts.rules
    .map((rule: RuleFacts, index: number): string | null => {
      const owners: { users: Array<string>; teams: Array<string> } =
        oracleRuleOwners(rule, facts);

      return oracleMatches(rule, facts) &&
        (owners.users.some(isMember) || owners.teams.some(teamReaches))
        ? ruleId(index)
        : null;
    })
    .filter((id: string | null): id is string => {
      return id !== null;
    });
}

function ruleId(index: number): string {
  return `70760000-0000-4000-8000-00000000010${index}`;
}

function withId<T extends { _id?: string | undefined }>(
  item: T,
  id: string,
): T {
  item._id = id;
  return item;
}

function labelsOf(ids: Array<string>): Array<Label> {
  return ids.map((id: string): Label => {
    return withId(new Label(), id);
  });
}

function monitorsOf(ids: Array<string>): Array<Monitor> {
  return ids.map((id: string): Monitor => {
    return withId(new Monitor(), id);
  });
}

function usersOf(ids: Array<string>): Array<User> {
  return ids.map((id: string): User => {
    return withId(new User(), id);
  });
}

function teamsOf(ids: Array<string>): Array<Team> {
  return ids.map((id: string): Team => {
    return withId(new Team(), id);
  });
}

function toIncidentRule(facts: RuleFacts, index: number): IncidentOwnerRule {
  const rule: IncidentOwnerRule = withId(
    new IncidentOwnerRule(),
    ruleId(index),
  );
  rule.name = `Owner rule ${index}`;
  rule.projectId = PROJECT_ID;
  rule.isEnabled = true;
  rule.notifyOwners = facts.notifyOwners;
  rule.incidentSeverities = facts.severities.map(
    (id: string): IncidentSeverity => {
      return withId(new IncidentSeverity(), id);
    },
  );
  rule.monitors = monitorsOf(facts.monitors);
  rule.incidentLabels = labelsOf(facts.labels);
  rule.monitorLabels = labelsOf(facts.monitorLabels);

  if (facts.titlePattern) {
    rule.incidentTitlePattern = facts.titlePattern;
  }

  if (facts.namePattern) {
    rule.monitorNamePattern = facts.namePattern;
  }

  rule.ownerUsers = usersOf(facts.users);
  rule.ownerTeams = teamsOf(facts.teams);
  rule.inheritOwnersFromMonitors = facts.inheritsFromMonitors;
  rule.inheritOwnersFromServices = facts.inheritsFromServices;
  return rule;
}

function toAlertRule(facts: RuleFacts, index: number): AlertOwnerRule {
  const rule: AlertOwnerRule = withId(new AlertOwnerRule(), ruleId(index));
  rule.name = `Owner rule ${index}`;
  rule.projectId = PROJECT_ID;
  rule.isEnabled = true;
  rule.notifyOwners = facts.notifyOwners;
  rule.alertSeverities = facts.severities.map((id: string): AlertSeverity => {
    return withId(new AlertSeverity(), id);
  });
  rule.monitors = monitorsOf(facts.monitors);
  rule.alertLabels = labelsOf(facts.labels);
  rule.monitorLabels = labelsOf(facts.monitorLabels);

  if (facts.titlePattern) {
    rule.alertTitlePattern = facts.titlePattern;
  }

  if (facts.namePattern) {
    rule.monitorNamePattern = facts.namePattern;
  }

  rule.ownerUsers = usersOf(facts.users);
  rule.ownerTeams = teamsOf(facts.teams);
  rule.inheritOwnersFromMonitors = facts.inheritsFromMonitors;
  rule.inheritOwnersFromServices = facts.inheritsFromServices;
  return rule;
}

function criteriaOf(
  facts: CaseFacts,
  kind: "incident" | "alert",
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-offline";
  instance.data!.name = "Offline";
  instance.data!.changeMonitorStatus = false;
  instance.data!.createIncidents = kind === "incident";
  instance.data!.createAlerts = kind === "alert";
  instance.data!.incidents = [];
  instance.data!.alerts = [];

  const template: Record<string, unknown> = {
    id: `${kind}-template`,
    title: facts.titleTemplate,
    description: "The check failed.",
    labelIds: facts.labels.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    ownerUserIds: facts.criteriaUsers.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    ownerTeamIds: facts.criteriaTeams.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  };

  if (kind === "incident") {
    instance.data!.incidents = [
      {
        ...template,
        incidentSeverityId: new ObjectID(facts.severity),
      } as never,
    ];
  } else {
    instance.data!.alerts = [
      {
        ...template,
        alertSeverityId: new ObjectID(facts.severity),
      } as never,
    ];
  }

  return instance;
}

function monitorOf(
  facts: CaseFacts,
  criteria: MonitorCriteriaInstance,
): Monitor {
  const monitor: Monitor = withId(new Monitor(), MONITOR_ID);
  monitor.name = facts.monitorName;
  monitor.description = "";
  monitor.monitorType = MonitorType.Website;
  monitor.projectId = PROJECT_ID;
  monitor.labels = labelsOf(facts.monitorLabels);
  monitor.monitorSteps = {
    data: {
      monitorStepsInstanceArray: [
        {
          id: new ObjectID(STEP_ID),
          data: {
            id: STEP_ID,
            monitorCriteria: {
              data: { monitorCriteriaInstanceArray: [criteria] },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
  return monitor;
}

// The ids a QueryHelper.any read asks for in one column.
function idsAt(query: unknown, column: string): Array<string> {
  const value: unknown = (query as Record<string, unknown> | undefined)?.[
    column
  ];
  const parameters: Record<string, unknown> =
    ((value as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((item: unknown): string => {
    return String(item).toLowerCase();
  });
}

// Who the card says is emailed.
function cardEmailed(event: WhoIsToldEvent): Emailed {
  if (event.owners.source === WhoIsToldOwnersSource.ProjectOwners) {
    return PROJECT_OWNERS;
  }

  // People and teams are named by their ids here.
  return {
    users: [...event.owners.userNames].sort(),
    teams: [...event.owners.teamNames].sort(),
  };
}

// An owner row of a real record, as its owner tables hold it.
interface OwnerRow {
  recordId: string;
  userId?: string;
  teamId?: string;
}

// Every owner row written, of every record a case makes.
let ownerRows: Array<OwnerRow> = [];

function idOf(value: unknown): string {
  return value ? String(value).toLowerCase() : "";
}

// A person, by id, as a read of them with their user loads them.
function personOf(userId: string): User {
  return withId(new User(), userId);
}

/*
 * One of the real record's owner tables, held in memory: what
 * OwnerRuleAssignment writes (createOwner), and what it and findOwners read
 * back - the record's rows, or those of the owners asked about.
 */
function stubOwnerTable(data: {
  service: unknown;
  makeRow: () => BaseModel;
  recordColumn: "incidentId" | "alertId";
  ownerColumn: "userId" | "teamId";
}): void {
  const table: Record<string, (...args: Array<unknown>) => Promise<unknown>> =
    data.service as Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    >;

  jest.spyOn(table, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<BaseModel>> => {
    const recordId: string = idOf(args.query[data.recordColumn]);
    const asked: Array<string> | null = args.query[data.ownerColumn]
      ? idsAt(args.query, data.ownerColumn)
      : null;

    return ownerRows
      .filter((row: OwnerRow): boolean => {
        const ownerId: string = row[data.ownerColumn] || "";

        return (
          row.recordId === recordId &&
          Boolean(ownerId) &&
          (!asked || asked.includes(ownerId))
        );
      })
      .map((row: OwnerRow): BaseModel => {
        const ownerId: string = row[data.ownerColumn]!;
        const item: BaseModel = data.makeRow();
        item.setColumnValue(data.recordColumn, new ObjectID(row.recordId));
        item.setColumnValue("projectId", PROJECT_ID);
        item.setColumnValue(data.ownerColumn, new ObjectID(ownerId));

        if (data.ownerColumn === "userId") {
          item.setColumnValue("user", personOf(ownerId));
        }

        return item;
      });
  }) as never);

  jest.spyOn(table, "create").mockImplementation((async (createBy: {
    data: BaseModel;
  }): Promise<BaseModel> => {
    ownerRows.push({
      recordId: idOf(createBy.data.getColumnValue(data.recordColumn)),
      [data.ownerColumn]: idOf(createBy.data.getColumnValue(data.ownerColumn)),
    });

    return createBy.data;
  }) as never);
}

/*
 * The project's team member rows (TEAM_ROWS), as TeamMemberService reads
 * them - every read of who is in a team, and of who is a member of the
 * project, the card's and the real record's alike.
 */
function stubTeamMembers(): void {
  const matching: (query: Record<string, unknown>) => Array<TeamRow> = (
    query: Record<string, unknown>,
  ): Array<TeamRow> => {
    if (query["projectId"] && idOf(query["projectId"]) !== idOf(PROJECT_ID)) {
      return [];
    }

    const teamIds: Array<string> | null = query["teamId"]
      ? idsAt(query, "teamId")
      : null;
    const userIds: Array<string> | null = query["userId"]
      ? query["userId"] instanceof ObjectID
        ? [idOf(query["userId"])]
        : idsAt(query, "userId")
      : null;

    return TEAM_ROWS.filter((row: TeamRow): boolean => {
      return (
        (!teamIds || teamIds.includes(row.teamId)) &&
        (!userIds || userIds.includes(row.userId)) &&
        (query["hasAcceptedInvitation"] !== true || row.isAccepted)
      );
    });
  };

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    return matching(args.query).map((row: TeamRow): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.projectId = PROJECT_ID;
      member.teamId = new ObjectID(row.teamId);
      member.userId = new ObjectID(row.userId);
      member.hasAcceptedInvitation = row.isAccepted;
      member.user = personOf(row.userId);
      return member;
    });
  }) as never);

  jest.spyOn(TeamMemberService, "countBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(matching(args.query).length);
  }) as never);
}

// The real record's owner rows, by id, sorted.
function realOwnerRows(recordId: string): {
  users: Array<string>;
  teams: Array<string>;
} {
  const rows: Array<OwnerRow> = ownerRows.filter((row: OwnerRow): boolean => {
    return row.recordId === recordId;
  });

  return {
    users: sortedUnique(
      rows
        .map((row: OwnerRow): string => {
          return row.userId || "";
        })
        .filter(Boolean),
    ),
    teams: sortedUnique(
      rows
        .map((row: OwnerRow): string => {
          return row.teamId || "";
        })
        .filter(Boolean),
    ),
  };
}

/*
 * Whom the real record's "created" email reaches, as its job reads them
 * (IncidentOwner:SendCreatedResourceEmail, AlertOwner:...): its owners by
 * findOwners - or, when that is nobody, the project's owners.
 */
async function realReached(
  kind: "incident" | "alert",
  recordId: string,
): Promise<Reached> {
  const owners: Array<User> =
    kind === "incident"
      ? await IncidentService.findOwners(new ObjectID(recordId))
      : await AlertService.findOwners(new ObjectID(recordId));

  if (owners.length === 0) {
    return PROJECT_OWNERS;
  }

  return sortedUnique(
    owners.map((owner: User): string => {
      return idOf(owner.id);
    }),
  );
}

// Whom the people and teams the card names reach, one by one.
function cardReached(event: WhoIsToldEvent): Reached {
  return reachedBy(cardEmailed(event));
}

interface EngineCase {
  kind: "incident" | "alert";
  label: string;
  stubRules: (rules: Array<RuleFacts>) => void;
  // Make the real record from the criteria, and apply the owner rules to it: its ids.
  makeReal: (data: {
    monitor: Monitor;
    criteria: MonitorCriteriaInstance;
  }) => Promise<Array<string>>;
}

const DATA_TO_PROCESS: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: new ObjectID(MONITOR_ID),
  monitorStepId: new ObjectID(STEP_ID),
  monitoredAt: new Date("2026-11-12T08:00:00.000Z"),
} as unknown as ProbeMonitorResponse;

let createdIncidents: Array<Incident> = [];
let createdAlerts: Array<Alert> = [];

const ENGINES: Array<EngineCase> = [
  {
    kind: "incident",
    label: "incident owner rules",
    stubRules: (rules: Array<RuleFacts>): void => {
      jest
        .spyOn(IncidentOwnerRuleService, "findBy")
        .mockResolvedValue(rules.map(toIncidentRule) as never);
    },
    makeReal: async (data: {
      monitor: Monitor;
      criteria: MonitorCriteriaInstance;
    }): Promise<Array<string>> => {
      createdIncidents = [];

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: data.criteria,
        monitor: data.monitor,
        dataToProcess: DATA_TO_PROCESS,
        rootCause: "The check failed",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
        openIncidents: [],
        props: {},
      });

      // What the create's chain runs on the new incident (IncidentService.onCreateSuccess).
      for (const incident of createdIncidents) {
        await IncidentOwnerRuleEngineService.applyRulesToIncident(incident);
      }

      return createdIncidents.map((incident: Incident): string => {
        return idOf(incident.id);
      });
    },
  },
  {
    kind: "alert",
    label: "alert owner rules",
    stubRules: (rules: Array<RuleFacts>): void => {
      jest
        .spyOn(AlertOwnerRuleService, "findBy")
        .mockResolvedValue(rules.map(toAlertRule) as never);
    },
    makeReal: async (data: {
      monitor: Monitor;
      criteria: MonitorCriteriaInstance;
    }): Promise<Array<string>> => {
      createdAlerts = [];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: data.criteria,
        monitor: data.monitor,
        dataToProcess: DATA_TO_PROCESS,
        rootCause: "The check failed",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
        openAlerts: [],
        props: {},
      });

      // What the create's chain runs on the new alert (AlertService.onCreateSuccess).
      for (const alert of createdAlerts) {
        await AlertOwnerRuleEngineService.applyRulesToAlert(alert);
      }

      return createdAlerts.map((alert: Alert): string => {
        return idOf(alert.id);
      });
    },
  },
];

describe.each(ENGINES)("$label", (engine: EngineCase) => {
  let facts: CaseFacts;
  let errors: SpyInstance<typeof logger.error>;

  // Everything both the card and the real record read, as the case says.
  function stubCase(): void {
    engine.stubRules(facts.rules);

    jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
      return monitorOf(facts, criteriaOf(facts, engine.kind));
    }) as never);

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockImplementation((async () => {
        return {
          ownerUserIds: facts.deviceUsers.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          ownerTeamIds: [],
        };
      }) as never);

    jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockImplementation((async () => {
        return {
          ...MonitorResourceContextUtil.emptyContext(),
          serviceIds: facts.isLinkedToService ? [SERVICE] : [],
        };
      }) as never);

    jest
      .spyOn(MonitorOwnerUserService, "findBy")
      .mockImplementation((async (args: { query: unknown }) => {
        return idsAt(args.query, "monitorId").includes(MONITOR_ID)
          ? facts.monitorOwners.map((id: string): MonitorOwnerUser => {
              const row: MonitorOwnerUser = new MonitorOwnerUser();
              row.userId = new ObjectID(id);
              return row;
            })
          : [];
      }) as never);

    jest
      .spyOn(ServiceOwnerUserService, "findBy")
      .mockImplementation((async (args: { query: unknown }) => {
        return idsAt(args.query, "serviceId").includes(SERVICE)
          ? facts.serviceOwners.map((id: string): ServiceOwnerUser => {
              const row: ServiceOwnerUser = new ServiceOwnerUser();
              row.userId = new ObjectID(id);
              return row;
            })
          : [];
      }) as never);
  }

  // The reads and writes no case changes.
  function stubBase(): void {
    errors = jest.spyOn(logger, "error");

    // The project's owner rules of the other kind: none (stubRules sets this kind's).
    jest
      .spyOn(IncidentOwnerRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(AlertOwnerRuleService, "findBy").mockResolvedValue([] as never);

    // The card's other reads: nothing pages, nothing is public, every channel is on.
    jest.spyOn(MonitorService, "findOneBy").mockImplementation((async () => {
      return monitorOf(facts, criteriaOf(facts, engine.kind));
    }) as never);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project() as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ServerSendingStatus, "getStatuses").mockResolvedValue([]);
    jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue(
      SEVERITIES.map((id: string): IncidentSeverity => {
        return withId(new IncidentSeverity(), id);
      }) as never,
    );
    jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue(
      SEVERITIES.map((id: string): AlertSeverity => {
        return withId(new AlertSeverity(), id);
      }) as never,
    );
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentOnCallRuleEngineService, "getMatchingRules")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertOnCallRuleEngineService, "getMatchingRules")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentOnCallRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(AlertOnCallRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(IncidentStatusPageScope, "resolvePagesForDraftIncident")
      .mockResolvedValue({
        statusPages: [],
        statusPageToResources: {},
        isScoped: false,
        excludedStatusPages: [],
      });
    jest
      .spyOn(ProjectService, "getOwners")
      .mockResolvedValue([withId(new User(), USERS[0]!)] as never);
    jest.spyOn(MonitorService, "findOwners").mockResolvedValue([] as never);

    // Each person and team is named by their id.
    jest.spyOn(UserService, "findBy").mockImplementation((async (args: {
      query: unknown;
    }) => {
      return idsAt(args.query, "_id").map((id: string): User => {
        const item: User = withId(new User(), id);
        item.name = id as never;
        return item;
      });
    }) as never);
    jest.spyOn(TeamService, "findBy").mockImplementation((async (args: {
      query: unknown;
    }) => {
      return idsAt(args.query, "_id").map((id: string): Team => {
        const item: Team = withId(new Team(), id);
        item.name = id;
        return item;
      });
    }) as never);

    // The real record's own reads and writes.
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest
      .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
      .mockImplementation((async (data: { ids: Array<ObjectID | string> }) => {
        return { usableIds: data.ids, droppedIds: [] };
      }) as never);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockImplementation((async () => {
        return MonitorResourceContextUtil.emptyContext();
      }) as never);
    jest.spyOn(DataAlertCause, "getSubject").mockResolvedValue(null);
    jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
      data: Incident;
    }) => {
      const incident: Incident = createBy.data;
      incident._id = ObjectID.generate().toString();
      createdIncidents.push(incident);
      return incident;
    }) as never);
    jest.spyOn(AlertService, "create").mockImplementation((async (createBy: {
      data: Alert;
    }) => {
      const alert: Alert = createBy.data;
      alert._id = ObjectID.generate().toString();
      // A create names the monitor in its ID column too (fillIdColumnsFromRelations).
      const monitorId: ObjectID | undefined =
        alert.monitorId || alert.monitor?.id || undefined;

      if (monitorId) {
        alert.monitorId = monitorId;
      }
      createdAlerts.push(alert);
      return alert;
    }) as never);
    /*
     * Its owners are added by the real IncidentService.addOwners
     * (AlertService's): rows in its owner tables, held here, for the
     * members of the project and for teams.
     */
    stubOwnerTable({
      service: IncidentOwnerUserService,
      makeRow: (): BaseModel => {
        return new IncidentOwnerUser();
      },
      recordColumn: "incidentId",
      ownerColumn: "userId",
    });
    stubOwnerTable({
      service: IncidentOwnerTeamService,
      makeRow: (): BaseModel => {
        return new IncidentOwnerTeam();
      },
      recordColumn: "incidentId",
      ownerColumn: "teamId",
    });
    stubOwnerTable({
      service: AlertOwnerUserService,
      makeRow: (): BaseModel => {
        return new AlertOwnerUser();
      },
      recordColumn: "alertId",
      ownerColumn: "userId",
    });
    stubOwnerTable({
      service: AlertOwnerTeamService,
      makeRow: (): BaseModel => {
        return new AlertOwnerTeam();
      },
      recordColumn: "alertId",
      ownerColumn: "teamId",
    });
    stubTeamMembers();
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorOwnerTeamService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceOwnerTeamService, "findBy")
      .mockResolvedValue([] as never);
  }

  beforeEach(() => {
    ownerRows = [];
    WhoIsToldService.clearCache();
    stubBase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    WhoIsToldService.clearCache();
  });

  // What the card says of the one record the criteria opens.
  async function cardEvent(): Promise<WhoIsToldEvent> {
    const result: WhoIsToldResult = await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: new ObjectID(MONITOR_ID),
      refresh: true,
    });

    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0]!.events).toHaveLength(1);

    return result.criteria[0]!.events[0]!;
  }

  test("the card's owners, the real record's owners and a plain reading of the rules agree on generated cases", async () => {
    const random: SeededRandom = seededRandom(7076);
    let byRules: number = 0;
    let byProject: number = 0;
    let named: number = 0;
    let leftOut: number = 0;

    for (let index: number = 0; index < CASES; index++) {
      facts = generateCase(random);
      ownerRows = [];
      stubCase();

      const event: WhoIsToldEvent = await cardEvent();
      const created: Array<string> = await engine.makeReal({
        monitor: monitorOf(facts, criteriaOf(facts, engine.kind)),
        criteria: criteriaOf(facts, engine.kind),
      });

      const expected: Emailed = oracleEmailed(facts);
      const context: string = JSON.stringify({ case: index, facts });

      expect({ context, created: created.length }).toEqual({
        context,
        created: 1,
      });
      expect({ context, title: event.title }).toEqual({
        context,
        title: renderedTitle(facts),
      });
      expect({ context, shown: cardEmailed(event) }).toEqual({
        context,
        shown: expected,
      });
      // The real record's owners: every member named, and every team, even one with nobody in it.
      expect({ context, rows: realOwnerRows(created[0]!) }).toEqual({
        context,
        rows: oracleOwnerRows(facts),
      });
      // Whom its email reaches is whom the people and teams the card names reach (#7211).
      expect({ context, reached: cardReached(event) }).toEqual({
        context,
        reached: reachedBy(expected),
      });
      expect({
        context,
        real: await realReached(engine.kind, created[0]!),
      }).toEqual({
        context,
        real: reachedBy(expected),
      });
      expect({
        context,
        ownerRules: event.ownerRules.map((rule: WhoIsToldRule): string => {
          return rule.id;
        }),
      }).toEqual({ context, ownerRules: oracleOwnerRules(facts) });
      // Nothing went wrong quietly on either side (both log and carry on).
      expect({ context, errors: errors.mock.calls }).toEqual({
        context,
        errors: [],
      });

      if (event.owners.source === WhoIsToldOwnersSource.OwnerRules) {
        byRules++;
      } else if (event.owners.source === WhoIsToldOwnersSource.Named) {
        named++;
      } else {
        byProject++;
      }

      const owners: { users: Array<string>; teams: Array<string> } =
        oracleOwners(facts);

      if (!owners.users.every(isMember) || !owners.teams.every(teamReaches)) {
        leftOut++;
      }
    }

    // The generator draws every kind of case, so the agreement means something.
    expect(byRules).toBeGreaterThan(CASES / 10);
    expect(byProject).toBeGreaterThan(CASES / 10);
    expect(named).toBeGreaterThan(CASES / 10);
    // Somebody who left, or a team the email reaches nobody through, among the owners.
    expect(leftOut).toBeGreaterThan(CASES / 10);
  });

  test("a rule that matches only the template as written adds nobody to the real record, and the card names nobody for it", async () => {
    facts = {
      monitorName: "Checkout API",
      monitorLabels: [],
      titleTemplate: "{{monitorName}} is offline",
      severity: SEVERITIES[0]!,
      labels: [],
      criteriaUsers: [],
      criteriaTeams: [],
      deviceUsers: [],
      monitorOwners: [],
      isLinkedToService: false,
      serviceOwners: [],
      rules: [
        {
          severities: [],
          monitors: [],
          labels: [],
          monitorLabels: [],
          titlePattern: "\\{\\{monitorName\\}\\}",
          namePattern: null,
          users: [USERS[1]!],
          teams: [],
          notifyOwners: true,
          inheritsFromMonitors: false,
          inheritsFromServices: false,
        },
      ],
    };
    stubCase();

    const event: WhoIsToldEvent = await cardEvent();
    const created: Array<string> = await engine.makeReal({
      monitor: monitorOf(facts, criteriaOf(facts, engine.kind)),
      criteria: criteriaOf(facts, engine.kind),
    });

    expect(event.title).toBe("Checkout API is offline");
    expect(cardEmailed(event)).toBe(PROJECT_OWNERS);
    expect(realOwnerRows(created[0]!)).toEqual({ users: [], teams: [] });
    expect(await realReached(engine.kind, created[0]!)).toBe(PROJECT_OWNERS);
  });

  /*
   * #7211, by hand: owners named everywhere a record gets them from, some
   * of whom the email does not reach - somebody who left, somebody who
   * never accepted, a team with nobody in it, a team with only an
   * invitation nobody accepted.
   */
  function departedAndEmpty(rules: Array<RuleFacts>): CaseFacts {
    return {
      monitorName: "Checkout API",
      monitorLabels: [],
      titleTemplate: "Checkout is down",
      severity: SEVERITIES[0]!,
      labels: [],
      criteriaUsers: [DEPARTED, USERS[1]!],
      criteriaTeams: [EMPTY_TEAM],
      deviceUsers: [PENDING],
      monitorOwners: [DEPARTED],
      isLinkedToService: false,
      serviceOwners: [],
      rules: rules,
    };
  }

  function ruleAdding(data: {
    users: Array<string>;
    teams: Array<string>;
    inheritsFromMonitors?: boolean;
  }): RuleFacts {
    return {
      severities: [],
      monitors: [],
      labels: [],
      monitorLabels: [],
      titlePattern: null,
      namePattern: null,
      users: data.users,
      teams: data.teams,
      notifyOwners: true,
      inheritsFromMonitors: data.inheritsFromMonitors || false,
      inheritsFromServices: false,
    };
  }

  test("an owner who left, one who never joined, and a team the email reaches nobody through are named by neither; the email reaches the rest", async () => {
    facts = departedAndEmpty([
      ruleAdding({ users: [DEPARTED], teams: [PENDING_TEAM] }),
      ruleAdding({ users: [], teams: [TEAMS[1]!] }),
    ]);
    stubCase();

    const event: WhoIsToldEvent = await cardEvent();
    const created: Array<string> = await engine.makeReal({
      monitor: monitorOf(facts, criteriaOf(facts, engine.kind)),
      criteria: criteriaOf(facts, engine.kind),
    });

    expect(event.owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: [USERS[1]!],
      teamNames: [TEAMS[1]!],
    });
    // Only the rule that adds a team somebody is in is why anyone is emailed.
    expect(
      event.ownerRules.map((rule: WhoIsToldRule): string => {
        return rule.id;
      }),
    ).toEqual([ruleId(1)]);
    // The real record owns the empty teams, but nobody who is not a member.
    expect(realOwnerRows(created[0]!)).toEqual({
      users: [USERS[1]!],
      teams: sortedUnique([EMPTY_TEAM, PENDING_TEAM, TEAMS[1]!]),
    });
    // Its email reaches the person, and the team's members - one with an invitation still pending among them.
    const reached: Reached = sortedUnique([USERS[1]!, USERS[3]!, USERS[0]!]);
    expect(cardReached(event)).toEqual(reached);
    expect(await realReached(engine.kind, created[0]!)).toEqual(reached);
    expect(errors).not.toHaveBeenCalled();
  });

  test("when every owner is somebody who left or a team with nobody in it, the card and the email both go to the project's owners", async () => {
    facts = departedAndEmpty([
      ruleAdding({ users: [PENDING], teams: [EMPTY_TEAM] }),
      ruleAdding({ users: [], teams: [], inheritsFromMonitors: true }),
    ]);
    facts.criteriaUsers = [DEPARTED];
    stubCase();

    const event: WhoIsToldEvent = await cardEvent();
    const created: Array<string> = await engine.makeReal({
      monitor: monitorOf(facts, criteriaOf(facts, engine.kind)),
      criteria: criteriaOf(facts, engine.kind),
    });

    expect(event.owners.source).toBe(WhoIsToldOwnersSource.ProjectOwners);
    expect(event.ownerRules).toEqual([]);
    expect(realOwnerRows(created[0]!)).toEqual({
      users: [],
      teams: [EMPTY_TEAM],
    });
    expect(await realReached(engine.kind, created[0]!)).toBe(PROJECT_OWNERS);
    expect(errors).not.toHaveBeenCalled();
  });

  test("the card adds nobody, attaches nothing and writes no feed: only the real record does", async () => {
    facts = {
      monitorName: "Checkout API",
      monitorLabels: [],
      titleTemplate: "Checkout is down",
      severity: SEVERITIES[0]!,
      labels: [],
      criteriaUsers: [USERS[0]!],
      criteriaTeams: [],
      deviceUsers: [],
      monitorOwners: [USERS[2]!],
      isLinkedToService: true,
      serviceOwners: [USERS[3]!],
      rules: [
        {
          severities: [],
          monitors: [],
          labels: [],
          monitorLabels: [],
          titlePattern: null,
          namePattern: null,
          users: [USERS[1]!],
          teams: [TEAMS[0]!],
          notifyOwners: true,
          inheritsFromMonitors: true,
          inheritsFromServices: true,
        },
      ],
    };
    stubCase();

    const event: WhoIsToldEvent = await cardEvent();

    expect(cardEmailed(event)).toEqual({
      users: sortedUnique(USERS),
      teams: [TEAMS[0]!],
    });
    expect(ownerRows).toEqual([]);
    expect(IncidentFeedService.createIncidentFeedItem).not.toHaveBeenCalled();
    expect(AlertFeedService.createAlertFeedItem).not.toHaveBeenCalled();
    expect(IncidentService.create).not.toHaveBeenCalled();
    expect(AlertService.create).not.toHaveBeenCalled();
  });
});
