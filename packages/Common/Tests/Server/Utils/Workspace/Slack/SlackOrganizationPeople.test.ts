import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import SlackAccountByEmail, {
  SlackEmailAccount,
} from "../../../../../Server/Utils/Workspace/Slack/SlackAccountByEmail";
import SlackChannelMembers, {
  SlackPersonFacts,
} from "../../../../../Server/Utils/Workspace/Slack/SlackChannelMembers";
import SlackUserGroups from "../../../../../Server/Utils/Workspace/Slack/SlackUserGroups";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceUserGroupLeftOutReason } from "../../../../../Types/Workspace/WorkspaceUserGroup";
import API from "../../../../../Utils/API";

/*
 * FINDING PEOPLE BY EMAIL WITH A WHOLE SLACK ENTERPRISE ORGANIZATION'S
 * TOKEN (#6749).
 *
 * A member of an Enterprise Grid organization is one Slack user across its
 * workspaces (a W... id), and users.lookupByEmail takes no team_id: asked
 * with the organization's token it finds them whichever workspace they
 * work in, as Slack documents it. Channel invitations
 * (SlackAccountByEmail, SlackChannelMembers) and on-call user groups
 * (SlackUserGroups.findPerson) look people up so; neither sends a
 * workspace. Not checked against a real Enterprise Grid sandbox: Slack is
 * stood in for at the HTTP layer (API.post), answering as its Web API
 * documents users.lookupByEmail for an organization's member.
 */

const ORGANIZATION_TOKEN: string = "xoxb-acme-organization";
const PROJECT_ID: ObjectID = new ObjectID(
  "c9000000-0000-4000-8000-000000000001",
);

interface SlackCall {
  method: string;
  body: JSONObject;
  authorization: string;
}

// Who somebody on call is in Slack, as SlackUserGroups.findPerson answers.
type SlackPersonLookup = Awaited<ReturnType<typeof SlackUserGroups.findPerson>>;

let calls: Array<SlackCall>;
// The organization's members, by email: what users.lookupByEmail answers.
let members: Map<string, JSONObject>;

// A member of the organization, as Slack answers for an Enterprise Grid user.
function gridMember(data: {
  id: string;
  email: string;
  // The workspace Slack names as theirs; they are in every one listed.
  teams: Array<string>;
  isGuest?: boolean | undefined;
  deleted?: boolean | undefined;
}): JSONObject {
  return {
    id: data.id,
    team_id: data.teams[0]!,
    name: data.email.split("@")[0]!,
    deleted: data.deleted === true,
    is_bot: false,
    is_restricted: data.isGuest === true,
    is_ultra_restricted: false,
    profile: { email: data.email, real_name: data.email.split("@")[0]! },
    enterprise_user: {
      id: data.id,
      enterprise_id: "E0ACME",
      enterprise_name: "Acme Corp",
      is_admin: false,
      is_owner: false,
      teams: data.teams,
    },
  };
}

function lookups(): Array<SlackCall> {
  return calls.filter((call: SlackCall): boolean => {
    return call.method === "users.lookupByEmail";
  });
}

beforeEach(() => {
  calls = [];
  members = new Map();

  members.set(
    "ana@acme.test",
    gridMember({
      id: "W0ANA",
      email: "ana@acme.test",
      teams: ["T0WEST", "T0EAST"],
    }),
  );
  members.set(
    "bo@acme.test",
    gridMember({ id: "W0BO", email: "bo@acme.test", teams: ["T0EAST"] }),
  );
  members.set(
    "guest@partner.test",
    gridMember({
      id: "W0GUEST",
      email: "guest@partner.test",
      teams: ["T0EAST"],
      isGuest: true,
    }),
  );
  members.set(
    "gone@acme.test",
    gridMember({
      id: "W0GONE",
      email: "gone@acme.test",
      teams: ["T0WEST"],
      deleted: true,
    }),
  );

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: URL;
    data: JSONObject;
    headers: Dictionary<string>;
  }): Promise<HTTPResponse<JSONObject>> => {
    const method: string = request.url.toString().split("/").pop() || "";
    const body: JSONObject = { ...(request.data || {}) };

    calls.push({
      method: method,
      body: body,
      authorization: String(request.headers?.["Authorization"] || ""),
    });

    let answer: JSONObject;

    if (method === "users.lookupByEmail") {
      const member: JSONObject | undefined = members.get(
        String(body["email"] || "").toLowerCase(),
      );

      answer = member
        ? { ok: true, user: member }
        : { ok: false, error: "users_not_found" };
    } else {
      answer = { ok: false, error: "unknown_method" };
    }

    return new HTTPResponse<JSONObject>(200, answer, {});
  }) as never);

  // No cache: each lookup asks Slack.
  jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("users.lookupByEmail with an organization's token", () => {
  test("asked with the organization's token and the email alone - no team_id: Slack finds the member across the organization", async () => {
    const person: SlackPersonFacts | null =
      await SlackChannelMembers.findPersonByEmail({
        authToken: ORGANIZATION_TOKEN,
        email: "ana@acme.test",
      });

    expect(lookups()).toEqual([
      {
        method: "users.lookupByEmail",
        body: { email: "ana@acme.test" },
        authorization: `Bearer ${ORGANIZATION_TOKEN}`,
      },
    ]);
    expect(person).toMatchObject({
      id: "W0ANA",
      email: "ana@acme.test",
      isBot: false,
      isDeactivated: false,
      isGuest: false,
    });
  });

  test("a member of one workspace only is found the same way: no workspace is named for any of them", async () => {
    for (const email of ["ana@acme.test", "bo@acme.test"]) {
      await SlackChannelMembers.findPersonByEmail({
        authToken: ORGANIZATION_TOKEN,
        email: email,
      });
    }

    expect(
      lookups().map((call: SlackCall): Array<string> => {
        return Object.keys(call.body);
      }),
    ).toEqual([["email"], ["email"]]);
  });

  test("nobody with the address: none, not an error", async () => {
    expect(
      await SlackChannelMembers.findPersonByEmail({
        authToken: ORGANIZATION_TOKEN,
        email: "nobody@acme.test",
      }),
    ).toBeNull();
  });
});

describe("a record's channel and a rule's invitations (SlackAccountByEmail)", () => {
  test("the member's one account in the organization - the account added to a channel in any of its workspaces", async () => {
    const account: SlackEmailAccount | null = await SlackAccountByEmail.find({
      projectId: PROJECT_ID,
      authToken: ORGANIZATION_TOKEN,
      userId: ObjectID.generate(),
      email: " Ana@Acme.test ",
      useCache: true,
    });

    expect(account).toEqual({ slackUserId: "W0ANA", isGuest: false });
    expect(lookups()[0]!.body).toEqual({ email: "ana@acme.test" });
    expect(lookups()[0]!.authorization).toBe(`Bearer ${ORGANIZATION_TOKEN}`);
  });

  test("a guest is found as a guest; a deactivated member is nobody to add", async () => {
    expect(
      await SlackAccountByEmail.find({
        projectId: PROJECT_ID,
        authToken: ORGANIZATION_TOKEN,
        userId: ObjectID.generate(),
        email: "guest@partner.test",
        useCache: false,
      }),
    ).toEqual({ slackUserId: "W0GUEST", isGuest: true });

    expect(
      await SlackAccountByEmail.find({
        projectId: PROJECT_ID,
        authToken: ORGANIZATION_TOKEN,
        userId: ObjectID.generate(),
        email: "gone@acme.test",
        useCache: false,
      }),
    ).toBeNull();
  });
});

describe("on-call user groups (SlackUserGroups.findPerson)", () => {
  test("somebody on call who has not connected their account is found by email with the organization's token - no team_id, whichever workspace the group is in", async () => {
    const lookup: SlackPersonLookup = await SlackUserGroups.findPerson({
      authToken: ORGANIZATION_TOKEN,
      person: {
        userId: ObjectID.generate(),
        email: "bo@acme.test",
        connectedWorkspaceUserId: null,
      },
    });

    expect(lookup).toEqual({ workspaceUserId: "W0BO" });
    expect(lookups()).toEqual([
      {
        method: "users.lookupByEmail",
        body: { email: "bo@acme.test" },
        authorization: `Bearer ${ORGANIZATION_TOKEN}`,
      },
    ]);
  });

  test("a guest of the organization is left out as a guest, as in one workspace", async () => {
    expect(
      await SlackUserGroups.findPerson({
        authToken: ORGANIZATION_TOKEN,
        person: {
          userId: ObjectID.generate(),
          email: "guest@partner.test",
          connectedWorkspaceUserId: null,
        },
      }),
    ).toEqual({ reason: WorkspaceUserGroupLeftOutReason.Guest });
  });
});
