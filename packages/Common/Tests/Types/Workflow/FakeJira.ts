/*
 * A Jira that answers the REST calls the Jira templates make, and keeps what
 * they change: issues with their labels, statuses, the transitions open from
 * each status, and comments. The equivalence suite gives a template and the
 * one it replaced a Jira of their own each, in the same state, and expects
 * them to leave it the same.
 *
 *   POST /rest/api/3/search/jql             the issues with a label
 *   GET  /rest/api/3/issue/{key}            an issue, labels and all
 *   POST /rest/api/3/issue                  a new issue
 *   PUT  /rest/api/3/issue/{key}            labels added
 *   POST /rest/api/3/issue/{key}/transitions a status change
 *   POST /rest/api/3/issue/{key}/comment     a comment
 *
 * Anything else is a 404, and a request without the Basic token is a 401,
 * as Jira answers them. Not a test file itself (jest only collects
 * *.test.ts).
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  DONE,
  IN_PROGRESS,
  TO_DO,
  jiraTransition,
} from "./JiraTemplateFixtures";
import { SimulatedReply, SimulatedRequest } from "./WorkflowTemplateSimulator";

export const FAKE_JIRA_SITE: string = "https://acme.atlassian.net";
export const FAKE_JIRA_TOKEN: string = "amFuZUBhY21lLmNvbTphcGl0b2tlbg==";

export interface FakeJiraIssue {
  key: string;
  summary: string;
  labels: Array<string>;
  status: JSONObject;
  comments: Array<JSONValue>;
}

export interface FakeJiraCall {
  method: string;
  path: string;
  body?: JSONValue | undefined;
}

// The transitions a simple software project offers, from wherever the issue is.
const TRANSITIONS: Array<JSONObject> = [
  jiraTransition({ id: "11", name: "To Do", to: TO_DO }),
  jiraTransition({ id: "21", name: "Start work", to: IN_PROGRESS }),
  jiraTransition({ id: "31", name: "Close", to: DONE }),
];

// The label a search names: labels = "oneuptime-incident-<id>".
const SEARCHED_LABEL: RegExp = /^labels = "([^"]+)"/;

export default class FakeJira {
  public issues: Map<string, FakeJiraIssue> = new Map();
  public calls: Array<FakeJiraCall> = [];
  public token: string = FAKE_JIRA_TOKEN;
  // Answer every write with this status, as Jira answers a refusal.
  public refuseWritesWith: number | null = null;
  private nextNumber: number = 100;

  public add(issue: Partial<FakeJiraIssue> & { key: string }): FakeJiraIssue {
    const added: FakeJiraIssue = {
      key: issue.key,
      summary: issue.summary || "Checkout API returns 502 for EU customers",
      labels: issue.labels || [],
      status: issue.status || TO_DO,
      comments: issue.comments || [],
    };

    this.issues.set(added.key, added);

    return added;
  }

  private issueJson(issue: FakeJiraIssue): JSONObject {
    return {
      id: `1${issue.key.split("-")[1]}`,
      self: `${FAKE_JIRA_SITE}/rest/api/3/issue/${issue.key}`,
      key: issue.key,
      fields: {
        summary: issue.summary,
        status: issue.status,
        labels: issue.labels,
      },
      transitions: TRANSITIONS,
    };
  }

  public answer(request: SimulatedRequest): SimulatedReply {
    const url: URL = new URL(request.url);
    const path: string = url.pathname;
    const method: string = request.method.toUpperCase();
    const authorization: string =
      Object.entries(request.headers).find(([name]: [string, string]) => {
        return name.toLowerCase() === "authorization";
      })?.[1] || "";

    this.calls.push({
      method: method,
      path: path + url.search,
      ...(request.body !== undefined ? { body: request.body } : {}),
    });

    if (authorization !== `Basic ${this.token}`) {
      return {
        status: 401,
        body: {
          errorMessages: [
            "Client must be authenticated to access this resource.",
          ],
        },
      };
    }

    const isRead: boolean =
      method === "GET" || path === "/rest/api/3/search/jql";

    if (!isRead && this.refuseWritesWith !== null) {
      return {
        status: this.refuseWritesWith,
        body: { errorMessages: ["Jira refused the request."], errors: {} },
      };
    }

    if (method === "POST" && path === "/rest/api/3/search/jql") {
      const jql: string = String((request.body as JSONObject)?.["jql"] || "");
      const label: string = SEARCHED_LABEL.exec(jql)?.[1] || "";

      return {
        status: 200,
        body: {
          issues: Array.from(this.issues.values())
            .filter((issue: FakeJiraIssue): boolean => {
              return issue.labels.includes(label);
            })
            .map((issue: FakeJiraIssue): JSONObject => {
              return this.issueJson(issue);
            }),
          isLast: true,
        },
      };
    }

    if (method === "POST" && path === "/rest/api/3/issue") {
      const fields: JSONObject =
        ((request.body as JSONObject)?.["fields"] as JSONObject) || {};

      this.nextNumber++;
      const issue: FakeJiraIssue = this.add({
        key: `OPS-${this.nextNumber}`,
        summary: String(fields["summary"] || ""),
        labels: ((fields["labels"] as Array<string>) || []).slice(),
      });

      return {
        status: 201,
        body: {
          id: `1${this.nextNumber}`,
          key: issue.key,
          self: `${FAKE_JIRA_SITE}/rest/api/3/issue/1${this.nextNumber}`,
        },
      };
    }

    const parts: Array<string> = path.split("/");
    // ["", "rest", "api", "3", "issue", "{key}", ...rest]
    const issue: FakeJiraIssue | undefined = this.issues.get(parts[5] || "");

    if (parts[4] !== "issue" || !issue) {
      return {
        status: 404,
        body: {
          errorMessages: [
            "Issue does not exist or you do not have permission to see it.",
          ],
          errors: {},
        },
      };
    }

    if (method === "GET" && parts.length === 6) {
      return { status: 200, body: this.issueJson(issue) };
    }

    if (method === "PUT" && parts.length === 6) {
      const update: JSONObject =
        ((request.body as JSONObject)?.["update"] as JSONObject) || {};

      for (const change of (update["labels"] as Array<JSONObject>) || []) {
        const added: string = String(change["add"] || "");

        if (added && !issue.labels.includes(added)) {
          issue.labels.push(added);
        }
      }

      return { status: 204, body: "" };
    }

    if (method === "POST" && parts[6] === "transitions") {
      const id: string = String(
        ((request.body as JSONObject)?.["transition"] as JSONObject)?.["id"] ||
          "",
      );
      const transition: JSONObject | undefined = TRANSITIONS.find(
        (candidate: JSONObject): boolean => {
          return candidate["id"] === id;
        },
      );

      if (!transition) {
        return {
          status: 400,
          body: {
            errorMessages: [
              "Transition id '" + id + "' is not valid for this issue.",
            ],
            errors: {},
          },
        };
      }

      issue.status = transition["to"] as JSONObject;

      return { status: 204, body: "" };
    }

    if (method === "POST" && parts[6] === "comment") {
      issue.comments.push(request.body || null);

      return {
        status: 201,
        body: { id: String(10000 + issue.comments.length) },
      };
    }

    return { status: 404, body: { errorMessages: ["Not found."], errors: {} } };
  }

  /*
   * What Jira holds once a run is over, and every call that changed it -
   * reads are left out: a template may read more or less, and still do the
   * same job.
   */
  public state(): JSONValue {
    return {
      issues: Array.from(this.issues.values())
        .sort((a: FakeJiraIssue, b: FakeJiraIssue): number => {
          return a.key.localeCompare(b.key);
        })
        .map((issue: FakeJiraIssue): JSONObject => {
          return {
            key: issue.key,
            summary: issue.summary,
            labels: issue.labels.slice().sort(),
            status: String(issue.status["name"]),
            comments: issue.comments,
          };
        }),
      writes: this.calls
        .filter((call: FakeJiraCall): boolean => {
          return !(
            call.method === "GET" ||
            call.path.startsWith("/rest/api/3/search/jql")
          );
        })
        .map((call: FakeJiraCall): JSONObject => {
          return {
            method: call.method,
            path: call.path,
            body: call.body || null,
          };
        }),
    };
  }
}
