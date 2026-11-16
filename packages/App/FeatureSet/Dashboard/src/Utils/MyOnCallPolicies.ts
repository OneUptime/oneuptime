import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Project from "Common/Models/DatabaseModels/Project";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * MY ON-CALL POLICIES: WHAT THE PERSON IS ON DUTY FOR, PROJECT BY PROJECT.
 *
 * The page reads two things side by side, however many projects the person
 * is in (#8124): their projects (for the names, in the order the project
 * picker lists them), and the escalation rules that page them in every
 * project they may open - one request across projects
 * (/on-call-duty-policy/current-on-duty-escalation-policies with the
 * is-multi-tenant-query header), whose rows each name their project. It
 * used to ask each project in turn, one request after another.
 */

// The rules that page the person, by kind: by their own name, a team's, a schedule's.
export interface OnDutyEscalationRules {
  escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser>;
  escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam>;
  escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

// A project the person is on duty in, with the rules that page them there.
export interface OnCallPolicyWithProject extends OnDutyEscalationRules {
  project: Project;
}

function readList<TModel extends DatabaseBaseModel>(
  json: JSONObject,
  key: string,
  modelType: { new (): TModel },
): Array<TModel> {
  const list: unknown = json[key];

  if (!Array.isArray(list)) {
    return [];
  }

  return DatabaseBaseModel.fromJSONArray(
    list as JSONArray,
    modelType,
  ) as Array<TModel>;
}

// The three lists of an answer, one project's or every project's.
export function readOnDutyEscalationRules(
  json: JSONObject | null | undefined,
): OnDutyEscalationRules {
  const answer: JSONObject = json || {};

  return {
    escalationRulesByUser: readList(
      answer,
      "escalationRulesByUser",
      OnCallDutyPolicyEscalationRuleUser,
    ),
    escalationRulesByTeam: readList(
      answer,
      "escalationRulesByTeam",
      OnCallDutyPolicyEscalationRuleTeam,
    ),
    escalationRulesBySchedule: readList(
      answer,
      "escalationRulesBySchedule",
      OnCallDutyPolicyEscalationRuleSchedule,
    ),
  };
}

function keyOf(projectId: ObjectID | string | null | undefined): string {
  return projectId ? projectId.toString().toLowerCase() : "";
}

/*
 * The projects, in their own order, that the person is on duty in, each
 * with its rules: a rule goes to the project it names. A project with no
 * rule is left out, and so is a rule of a project not in the list.
 */
export function groupOnCallPoliciesByProject(data: {
  projects: Array<Project>;
  rules: OnDutyEscalationRules;
}): Array<OnCallPolicyWithProject> {
  const byProject: Map<string, OnCallPolicyWithProject> = new Map<
    string,
    OnCallPolicyWithProject
  >();

  for (const project of data.projects) {
    const projectKey: string = keyOf(project._id);

    if (!projectKey || byProject.has(projectKey)) {
      continue;
    }

    byProject.set(projectKey, {
      project: project,
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
  }

  for (const rule of data.rules.escalationRulesByUser) {
    byProject.get(keyOf(rule.projectId))?.escalationRulesByUser.push(rule);
  }

  for (const rule of data.rules.escalationRulesByTeam) {
    byProject.get(keyOf(rule.projectId))?.escalationRulesByTeam.push(rule);
  }

  for (const rule of data.rules.escalationRulesBySchedule) {
    byProject.get(keyOf(rule.projectId))?.escalationRulesBySchedule.push(rule);
  }

  return Array.from(byProject.values()).filter(
    (projectData: OnCallPolicyWithProject): boolean => {
      return (
        projectData.escalationRulesByUser.length > 0 ||
        projectData.escalationRulesByTeam.length > 0 ||
        projectData.escalationRulesBySchedule.length > 0
      );
    },
  );
}
