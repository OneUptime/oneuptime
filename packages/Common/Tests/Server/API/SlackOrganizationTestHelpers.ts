import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthToken, {
  SlackOrganizationWorkspace,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import {
  cookieHeader,
  httpGet,
  ProbeResponse,
  queryOf,
} from "./WorkspaceOAuthTestHelpers";

/*
 * A SLACK ENTERPRISE ORGANIZATION, FOR THE ROUTES' TESTS.
 *
 * The tests of OneUptime installed for a whole Slack Enterprise organization
 * (SlackOrganization) drive the real SlackAPI routes, and under them the
 * real WorkspaceProjectAuthTokenService - its refusal to repoint a project
 * to another workspace, its writes of the organization's workspaces and
 * default - so what a route stores is what the next request reads. Two
 * things are stood in for:
 *
 * - the database under the service: an in-memory table of projects' Slack
 *   connections (InMemorySlackConnections), whose reads hand back only the
 *   columns a caller selected, as the database does;
 * - Slack (FakeSlack): every Web API request is recorded with the token it
 *   was made with, and answered as Slack answers it for an organization -
 *   the workspaces OneUptime was added to (auth.teams.list), a workspace's
 *   organization (auth.test), each workspace's channels (conversations.list
 *   with team_id).
 */

export const ORG_ID: string = "E0ACMECORP";
export const ORG_NAME: string = "Acme Corp";
export const ORG_TOKEN: string = "xoxb-acme-organization";

/*
 * A workspace of the organization, as a connection's miscData keeps it and
 * a route answers it: JSON too, so it can be written into either.
 */
export type SlackWorkspaceRow = SlackOrganizationWorkspace & JSONObject;

// Workspaces of the organization OneUptime is added to.
export const EAST: SlackWorkspaceRow = {
  id: "T0EAST",
  name: "Acme East",
};
export const WEST: SlackWorkspaceRow = {
  id: "T0WEST",
  name: "Acme West",
};
// Added to the organization's installation later, in Slack.
export const LAB: SlackWorkspaceRow = {
  id: "T0LAB",
  name: "Acme Lab",
};

// Another Enterprise organization, and a workspace of no organization.
export const OTHER_ORG_ID: string = "E0GLOBEX";
export const OTHER_ORG_WORKSPACE_ID: string = "T0GLOBEXHQ";
export const LONE_WORKSPACE_ID: string = "T0LONELY";

// A connection's row, as the table stores it.
export interface StoredSlackConnection {
  id: ObjectID;
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  authToken: string;
  authTokenExpiresAt: Date | null;
  workspaceProjectId: string;
  miscData: JSONObject;
  createdAt: Date;
}

const SELECT_TO_ROW: Record<string, keyof StoredSlackConnection> = {
  _id: "id",
  id: "id",
  projectId: "projectId",
  workspaceType: "workspaceType",
  authToken: "authToken",
  authTokenExpiresAt: "authTokenExpiresAt",
  workspaceProjectId: "workspaceProjectId",
  miscData: "miscData",
  createdAt: "createdAt",
};

function copyOf<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function sameValue(stored: unknown, asked: unknown): boolean {
  if (stored instanceof ObjectID || asked instanceof ObjectID) {
    return String(stored).toLowerCase() === String(asked).toLowerCase();
  }

  return stored === asked;
}

/*
 * Projects' Slack connections, in memory, behind the real service: its
 * findOneBy, findBy, updateOneById and create are what reads and writes
 * them.
 */
export class InMemorySlackConnections {
  public rows: Array<StoredSlackConnection> = [];
  // Every write, in order: what a test may say was - or was not - stored.
  public writes: Array<{ kind: "create" | "update"; data: JSONObject }> = [];

  private clock: number = Date.parse("2026-11-01T00:00:00.000Z");

  public add(data: {
    projectId: ObjectID;
    workspaceProjectId: string;
    authToken?: string | undefined;
    miscData?: JSONObject | undefined;
    workspaceType?: WorkspaceType | undefined;
  }): StoredSlackConnection {
    const row: StoredSlackConnection = {
      id: ObjectID.generate(),
      projectId: data.projectId,
      workspaceType: data.workspaceType || WorkspaceType.Slack,
      authToken: data.authToken || "xoxb-stored-token",
      authTokenExpiresAt: null,
      workspaceProjectId: data.workspaceProjectId,
      miscData: copyOf(data.miscData || {}),
      createdAt: new Date((this.clock += 1000)),
    };

    this.rows.push(row);

    return row;
  }

  // The project's Slack connection, as stored now.
  public slackOf(projectId: ObjectID): StoredSlackConnection | undefined {
    return this.rows.find((row: StoredSlackConnection): boolean => {
      return (
        row.workspaceType === WorkspaceType.Slack &&
        sameValue(row.projectId, projectId)
      );
    });
  }

  // Installs the table under the real service.
  public install(): void {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async (options: {
        query: JSONObject;
        select?: Record<string, boolean>;
      }) => {
        const row: StoredSlackConnection | undefined = this.match(
          options.query,
        )[0];

        return row ? this.project(row, options.select) : null;
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async (options: {
        query: JSONObject;
        select?: Record<string, boolean>;
      }) => {
        return this.match(options.query).map(
          (row: StoredSlackConnection): WorkspaceProjectAuthToken => {
            return this.project(row, options.select);
          },
        );
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockImplementation((async (options: {
        id: ObjectID;
        data: JSONObject;
      }) => {
        const row: StoredSlackConnection | undefined = this.rows.find(
          (candidate: StoredSlackConnection): boolean => {
            return sameValue(candidate.id, options.id);
          },
        );

        if (!row) {
          throw new Error(`No connection ${options.id.toString()} to update.`);
        }

        const data: JSONObject = options.data;

        this.writes.push({ kind: "update", data: copyOf(data) });

        if (data["authToken"] !== undefined) {
          row.authToken = data["authToken"] as string;
        }

        if (data["authTokenExpiresAt"] !== undefined) {
          row.authTokenExpiresAt = data["authTokenExpiresAt"] as Date | null;
        }

        if (data["workspaceProjectId"] !== undefined) {
          row.workspaceProjectId = data["workspaceProjectId"] as string;
        }

        if (data["miscData"] !== undefined) {
          row.miscData = copyOf(data["miscData"] as JSONObject);
        }
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "create")
      .mockImplementation((async (options: {
        data: WorkspaceProjectAuthToken;
      }) => {
        const model: WorkspaceProjectAuthToken = options.data;

        this.writes.push({
          kind: "create",
          data: {
            workspaceProjectId: model.workspaceProjectId || "",
            miscData: copyOf((model.miscData || {}) as JSONObject),
          },
        });

        this.add({
          projectId: model.projectId!,
          workspaceProjectId: model.workspaceProjectId || "",
          authToken: model.authToken || "",
          miscData: (model.miscData || {}) as JSONObject,
          workspaceType: model.workspaceType,
        });

        return model;
      }) as never);
  }

  private match(query: JSONObject): Array<StoredSlackConnection> {
    return this.rows
      .filter((row: StoredSlackConnection): boolean => {
        return Object.keys(query).every((key: string): boolean => {
          const field: keyof StoredSlackConnection | undefined =
            SELECT_TO_ROW[key];

          if (!field) {
            throw new Error(`The table does not know the column ${key}.`);
          }

          return sameValue(row[field], query[key]);
        });
      })
      .sort((a: StoredSlackConnection, b: StoredSlackConnection): number => {
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  // Only the columns selected, as the database hands them back.
  private project(
    row: StoredSlackConnection,
    select: Record<string, boolean> | undefined,
  ): WorkspaceProjectAuthToken {
    const model: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();

    for (const key of Object.keys(select || {})) {
      if (!select![key]) {
        continue;
      }

      const field: keyof StoredSlackConnection | undefined = SELECT_TO_ROW[key];

      if (!field) {
        continue;
      }

      switch (field) {
        case "id":
          model.id = row.id;
          break;
        case "projectId":
          model.projectId = row.projectId;
          break;
        case "workspaceType":
          model.workspaceType = row.workspaceType;
          break;
        case "authToken":
          model.authToken = row.authToken;
          break;
        case "authTokenExpiresAt":
          if (row.authTokenExpiresAt) {
            model.authTokenExpiresAt = row.authTokenExpiresAt;
          }
          break;
        case "workspaceProjectId":
          model.workspaceProjectId = row.workspaceProjectId;
          break;
        case "miscData":
          model.miscData = copyOf(row.miscData) as never;
          break;
        case "createdAt":
          model.createdAt = row.createdAt;
          break;
      }
    }

    return model;
  }
}

// A request OneUptime made of Slack.
export interface SlackCall {
  method: string;
  data: JSONObject;
  // The token it was made with; empty for none (an OAuth exchange).
  token: string;
}

export type SlackAnswer = (call: SlackCall) => JSONObject;

/*
 * Slack, as an organization's installation sees it. Every Web API request
 * is recorded; the answers are each method's, set by a test, and `{ ok: true }`
 * for any other.
 */
export class FakeSlack {
  public calls: Array<SlackCall> = [];

  // auth.teams.list: the workspaces each token's installation was added to.
  public workspacesOfToken: Map<string, Array<SlackOrganizationWorkspace>> =
    new Map();

  // auth.test: what each token says of itself.
  public authTestOfToken: Map<string, JSONObject> = new Map();

  // conversations.list: each workspace's channels ("" for a call with no team_id).
  public channelsOfTeam: Map<string, Array<{ id: string; name: string }>> =
    new Map();

  // A method's own answer, over everything above.
  public answers: Map<string, SlackAnswer> = new Map();

  public install(): void {
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data?: JSONObject;
      headers?: Record<string, string>;
    }) => {
      const method: string = options.url.toString().split("/api/").pop() || "";
      const authorization: string =
        (options.headers?.["Authorization"] as string | undefined) || "";

      const call: SlackCall = {
        method: method,
        data: copyOf(options.data || {}),
        token: authorization.replace(/^Bearer /, ""),
      };

      this.calls.push(call);

      return new HTTPResponse<JSONObject>(200, this.answer(call), {});
    }) as never);
  }

  public callsOf(method: string): Array<SlackCall> {
    return this.calls.filter((call: SlackCall): boolean => {
      return call.method === method;
    });
  }

  private answer(call: SlackCall): JSONObject {
    const own: SlackAnswer | undefined = this.answers.get(call.method);

    if (own) {
      return own(call);
    }

    if (call.method === "auth.teams.list") {
      const workspaces: Array<SlackOrganizationWorkspace> | undefined =
        this.workspacesOfToken.get(call.token);

      if (!workspaces) {
        return { ok: false, error: "invalid_auth" };
      }

      return {
        ok: true,
        teams: workspaces.map(
          (workspace: SlackOrganizationWorkspace): JSONObject => {
            return { id: workspace.id, name: workspace.name };
          },
        ),
        response_metadata: { next_cursor: "" },
      };
    }

    if (call.method === "auth.test") {
      return this.authTestOfToken.get(call.token) || { ok: false };
    }

    if (call.method === "conversations.list") {
      const teamId: string =
        typeof call.data["team_id"] === "string"
          ? (call.data["team_id"] as string)
          : "";

      const channels: Array<{ id: string; name: string }> | undefined =
        this.channelsOfTeam.get(teamId);

      if (!channels) {
        // What Slack answers an organization's token that names no workspace.
        return {
          ok: false,
          error: teamId ? "team_not_found" : "missing_argument",
        };
      }

      return {
        ok: true,
        channels: channels,
        response_metadata: { next_cursor: "" },
      };
    }

    return { ok: true };
  }
}

// The browser of whoever starts a connection: its binding cookie.
export type Browser = Record<string, string>;

/*
 * Starts a connection (install or sign-in) as a signed-in member: the
 * authorization URL's state, and the cookie the browser carries back.
 */
export async function startConnection(data: {
  port: number;
  path: string;
  headers: Record<string, string>;
  cookieName: string;
}): Promise<{ state: string; url: string; browser: Browser }> {
  const response: ProbeResponse = await httpGet({
    port: data.port,
    path: data.path,
    headers: data.headers,
  });

  if (response.status !== 200) {
    throw new Error(
      `Starting ${data.path} was answered ${response.status}: ${JSON.stringify(
        response.body,
      )}`,
    );
  }

  const url: string = (response.body as JSONObject)[
    "authorizationUrl"
  ] as string;

  return {
    state: queryOf(url).get("state")!,
    url: url,
    browser: { [data.cookieName]: response.setCookies[data.cookieName]! },
  };
}

// Where Slack sends the browser back: the callback, with the state and code.
export function finishConnection(data: {
  port: number;
  path: string;
  query: Record<string, string>;
  browser: Browser;
}): Promise<ProbeResponse> {
  return httpGet({
    port: data.port,
    path: `${data.path}?${new URLSearchParams(data.query).toString()}`,
    headers: { cookie: cookieHeader(data.browser) },
    timeoutMs: 20000,
  });
}
