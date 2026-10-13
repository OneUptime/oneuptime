/*
 * The Page steps on the real canvas - Page Users, Page a Team, Page Whoever
 * Is On Call and Page an On-Call Policy - and the project their settings pick
 * from.
 *
 * ?scenario=page              On Create Incident, then Page Whoever Is On
 *                             Call (schedule Primary, about the incident
 *                             that started the workflow) and, on its Error
 *                             output, a Page Users nobody has set up yet
 * ?scenario=page-new          Manual, then Page Users: two people and a
 *                             value from the trigger, about a new alert
 * ?scenario=page-conditional  On Create Incident, then a Switch / Case on
 *                             the incident's severity: "Critical" pages an
 *                             on-call policy, "Major" pages a team, and
 *                             anything else pages one person
 * ?scenario=page-trigger      just On Create Incident: a Page step added to
 *                             it starts as a page about that incident
 * ?scenario=page-alert        just On Create Alert, for the same
 *
 * ?page=direct-page            what the on-call logs draw where a run's
 *                              policy would be named, for a page with no
 *                              policy behind it: the real label, in the
 *                              narrow column a logs table gives it
 *
 * The settings pick from the project through the API, which is not here.
 * installPageProject stands in for it: the project's people, teams, on-call
 * schedules, on-call policies and alert severities, answering a search by
 * name and a lookup by id the way the API does. ?project=empty is a project
 * with nobody and nothing in it.
 */
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import DirectPageLabel from "Common/UI/Components/OnCallDirectPage/DirectPageLabel";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React from "react";

export const PAGE_PROJECT_ID = "22222222-2222-4222-8222-222222222222";

export const PEOPLE = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Jane Doe",
    email: "jane@example.com",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "John Roe",
    email: "john@example.com",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Alex Kim",
    email: "alex@example.com",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Priya Natarajan-Sundaramoorthy",
    email: "priya.natarajan-sundaramoorthy@example.com",
  },
];

export const TEAMS = [
  { id: "7eae0000-0000-4000-8000-000000000001", name: "Platform" },
  { id: "7eae0000-0000-4000-8000-000000000002", name: "Database" },
  { id: "7eae0000-0000-4000-8000-000000000003", name: "Customer Support" },
];

export const SCHEDULES = [
  { id: "5c4e0000-0000-4000-8000-000000000001", name: "Primary" },
  { id: "5c4e0000-0000-4000-8000-000000000002", name: "Secondary" },
  { id: "5c4e0000-0000-4000-8000-000000000003", name: "Weekend Rotation" },
];

export const POLICIES = [
  { id: "dddddddd-0000-4000-8000-000000000001", name: "Critical" },
  { id: "dddddddd-0000-4000-8000-000000000002", name: "Database" },
  {
    id: "dddddddd-0000-4000-8000-000000000003",
    name: "Old rota",
    isArchived: true,
  },
];

export const SEVERITIES = [
  { id: "5e5e0000-0000-4000-8000-000000000001", name: "Critical", order: 1 },
  { id: "5e5e0000-0000-4000-8000-000000000002", name: "High", order: 2 },
  { id: "5e5e0000-0000-4000-8000-000000000003", name: "Low", order: 3 },
];

const INCIDENT_ID_FROM_TRIGGER =
  "{{local.components.incident-on-create-1.returnValues.model._id}}";

/*
 * The nodes and edges of a Page scenario, or null for any other scenario.
 * `step` and `edge` are the fixture's own builders.
 */
export function getPageScenario(scenario, step, edge) {
  if (scenario === "page") {
    return {
      nodes: [
        step("incident-on-create", 1, 160, 32),
        step("page-on-call", 1, 160, 256, {
          "on-call-schedules": [SCHEDULES[0].id],
          about: "incident",
          "incident-id": INCIDENT_ID_FROM_TRIGGER,
        }),
        step("page-users", 1, 544, 496),
        step("log", 1, 160, 496, { value: "Somebody was paged" }),
      ],
      edges: [
        edge("canvas-incident-on-create-1", "success", "canvas-page-on-call-1"),
        edge("canvas-page-on-call-1", "success", "canvas-log-1"),
        edge("canvas-page-on-call-1", "error", "canvas-page-users-1"),
      ],
    };
  }

  if (scenario === "page-new") {
    return {
      nodes: [
        step("manual", 1, 160, 32),
        step("page-users", 1, 160, 256, {
          users: [
            PEOPLE[0].id,
            PEOPLE[1].id,
            "{{local.components.manual-1.returnValues.value.owners}}",
          ],
          about: "new-alert",
          title: "Payments are failing",
          message: "Card payments fail at checkout.",
        }),
      ],
      edges: [edge("canvas-manual-1", "success", "canvas-page-users-1")],
    };
  }

  if (scenario === "page-conditional") {
    return {
      nodes: [
        step("incident-on-create", 1, 160, 32),
        step("switch", 1, 160, 240, {
          value:
            "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",
          cases: [
            {
              id: "case-1",
              comparison: "==",
              value: "Critical",
              compareAs: "",
            },
            { id: "case-2", comparison: "==", value: "Major", compareAs: "" },
          ],
        }),
        step("page-on-call-policy", 1, -224, 496, {
          "on-call-policies": [POLICIES[0].id],
          about: "incident",
          "incident-id": INCIDENT_ID_FROM_TRIGGER,
        }),
        step("page-team", 1, 160, 496, {
          teams: [TEAMS[0].id, TEAMS[1].id],
          about: "incident",
          "incident-id": INCIDENT_ID_FROM_TRIGGER,
        }),
        step("page-users", 1, 544, 496, {
          users: [PEOPLE[0].id],
          about: "incident",
          "incident-id": INCIDENT_ID_FROM_TRIGGER,
        }),
      ],
      edges: [
        edge("canvas-incident-on-create-1", "success", "canvas-switch-1"),
        edge("canvas-switch-1", "case-1", "canvas-page-on-call-policy-1"),
        edge("canvas-switch-1", "case-2", "canvas-page-team-1"),
        edge("canvas-switch-1", "default", "canvas-page-users-1"),
      ],
    };
  }

  if (scenario === "page-trigger") {
    return { nodes: [step("incident-on-create", 1, 160, 64)], edges: [] };
  }

  if (scenario === "page-alert") {
    return { nodes: [step("alert-on-create", 1, 160, 64)], edges: [] };
  }

  return null;
}

function result(data) {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

// The rows a query asks for: by id, by a search of their name, or all.
function matching(rows, query, searchKeys) {
  const ids = query && query._id instanceof Includes ? query._id.values : null;

  if (ids) {
    const wanted = ids.map((id) => {
      return id.toString().toLowerCase();
    });

    return rows.filter((row) => {
      return wanted.includes(row.id);
    });
  }

  let found = rows;

  for (const key of searchKeys) {
    const search = query ? query[key] : null;

    if (search instanceof Search) {
      const text = search.toString().toLowerCase();

      found = found.filter((row) => {
        return String(row[key] || "")
          .toLowerCase()
          .includes(text);
      });
    }
  }

  return found;
}

function userModel(person) {
  const user = new User();
  user._id = person.id;
  user.name = new Name(person.name);
  user.email = new Email(person.email);
  return user;
}

/*
 * Stands in for the API the settings list the project through. Every list
 * the fixture is asked for is noted in window.__listRequests, so a spec can
 * hold which records a setting asked for and how.
 */
export function installPageProject(params) {
  const isEmpty = params.get("project") === "empty";

  window.__listRequests = [];

  ProjectUtil.getCurrentProjectId = () => {
    return new ObjectID(PAGE_PROJECT_ID);
  };

  ModelAPI.getList = async (data) => {
    const query = data.query || {};

    window.__listRequests.push({
      model: new data.modelType().tableName,
      query: JSON.parse(JSON.stringify(query)),
      limit: data.limit,
    });

    if (isEmpty) {
      return result([]);
    }

    if (data.modelType === TeamMember) {
      // A person is listed through their team memberships, by name or email.
      const userQuery = query.user || {};
      const ids = query.userId instanceof Includes ? query.userId.values : null;
      let people = PEOPLE;

      if (ids) {
        const wanted = ids.map((id) => {
          return id.toString().toLowerCase();
        });
        people = PEOPLE.filter((person) => {
          return wanted.includes(person.id);
        });
      } else {
        people = matching(PEOPLE, userQuery, ["name", "email"]);
      }

      return result(
        people.map((person) => {
          const member = new TeamMember();
          member._id = `member-${person.id}`;
          member.user = userModel(person);
          return member;
        }),
      );
    }

    if (data.modelType === Team) {
      return result(
        matching(TEAMS, query, ["name"]).map((row) => {
          const team = new Team();
          team._id = row.id;
          team.name = row.name;
          return team;
        }),
      );
    }

    if (data.modelType === OnCallDutyPolicySchedule) {
      return result(
        matching(SCHEDULES, query, ["name"]).map((row) => {
          const schedule = new OnCallDutyPolicySchedule();
          schedule._id = row.id;
          schedule.name = row.name;
          return schedule;
        }),
      );
    }

    if (data.modelType === OnCallDutyPolicy) {
      return result(
        matching(POLICIES, query, ["name"])
          .filter((row) => {
            // The search leaves archived policies out; a lookup by id does not.
            return query.isArchived === false ? !row.isArchived : true;
          })
          .map((row) => {
            const policy = new OnCallDutyPolicy();
            policy._id = row.id;
            policy.name = row.name;
            policy.isArchived = Boolean(row.isArchived);
            return policy;
          }),
      );
    }

    if (data.modelType === AlertSeverity) {
      return result(
        SEVERITIES.map((row) => {
          const severity = new AlertSeverity();
          severity._id = row.id;
          severity.name = row.name;
          severity.order = row.order;
          return severity;
        }),
      );
    }

    return result([]);
  };
}

/*
 * The on-call logs' first column, as wide as a logs table draws it on a
 * laptop (the cell is 14rem): a policy's run names its policy, and a direct
 * page says what it is and what started it.
 */
export function DirectPageLogsPage() {
  const cell = {
    width: "14rem",
    padding: "12px 16px",
    verticalAlign: "top",
  };

  return (
    <div style={{ padding: "16px" }}>
      <table
        data-testid="on-call-logs"
        className="rounded-lg border border-gray-200 bg-white text-sm text-gray-900"
      >
        <thead>
          <tr>
            <th style={cell} className="text-left font-medium text-gray-500">
              Policy Name
            </th>
            <th style={cell} className="text-left font-medium text-gray-500">
              Triggered By
            </th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="run-policy">
            <td style={cell}>Critical</td>
            <td style={cell}>Incident: Checkout is down</td>
          </tr>
          <tr data-testid="run-direct-workflow">
            <td style={cell}>
              <DirectPageLabel
                dataTestId="direct-workflow"
                workflowName="Page whoever is on call for critical incidents in the payments platform"
              />
            </td>
            <td style={cell}>Incident: Checkout is down</td>
          </tr>
          <tr data-testid="run-direct-person">
            <td style={cell}>
              <DirectPageLabel
                dataTestId="direct-person"
                startedBy={<span data-testid="started-by">Jane Doe</span>}
              />
            </td>
            <td style={cell}>Alert: Database CPU is above 90%</td>
          </tr>
          <tr data-testid="run-direct-plain">
            <td style={cell}>
              <DirectPageLabel dataTestId="direct-plain" />
            </td>
            <td style={cell}>Alert: Disk is full</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
