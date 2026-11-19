jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import InvitationLink from "../../../Server/Utils/InvitationLink";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * WHO IS HANDED AN INVITATION LINK (#7168).
 *
 * A pending person's invitation link carries a registration token, and the
 * token claims their account, with every invitation it holds
 * (GHSA-qg84-6hrg-mr5g). On a server that cannot send email, a master
 * admin reads it - right after their Invite, or later from Get Invitation
 * Link on the person's row - to send it themselves. Nobody else may read
 * it, whatever they may do in the project: a project's owner who invited
 * the person is told to ask the server's admin.
 *
 * A real HTTP request to a real Express app, through the real
 * TeamMemberAPI router and the real master-admin middleware. Only the
 * session the middleware reads is stood in for (readRequestSession, which
 * reads whether the person is a master admin now, from their account, and
 * is tested on its own in MasterAdminRemovalOverHttp), and the link itself
 * (InvitationLink, tested on its own).
 */

const TEAM_MEMBER_ID: ObjectID = new ObjectID(
  "71680000-0000-4000-8000-0000000000a1",
);
const REGISTRATION_LINK: string =
  "https://oneuptime.example.com/accounts/register?email=pending%40example.com&token=71680000-0000-4000-8000-0000000000ff";

function session(isMasterAdmin: boolean): JSONWebTokenData {
  return {
    userId: new ObjectID("71680000-0000-4000-8000-0000000000b1"),
    email: new Email("someone@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
}

function postInvitationLink(
  port: number,
  body: JSONObject,
  route: string = "/api/team-member/invitation-link",
): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(body);
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: route,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let parsed: JSONObject | null = null;

            try {
              parsed = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              parsed = null;
            }

            resolve({
              status: response.statusCode || 0,
              raw: raw,
              body: parsed,
            });
          });
        },
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

let server: http.Server;
let port: number;
let getLink: SpyInstance<typeof InvitationLink.getForTeamMember>;
let getNotSignedUp: SpyInstance<
  typeof InvitationLink.getMembershipsNotSignedUp
>;

function sessionIs(answer: RequestSession): void {
  jest.spyOn(UserMiddleware, "readRequestSession").mockResolvedValue(answer);
}

beforeAll(async () => {
  const app: express.Express = express();
  app.use(express.json());
  const router: ExpressRouter = express.Router();
  router.use(new TeamMemberAPI().getRouter());
  app.use("/api", router);
  app.use(expressErrorHandler);

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  getLink = jest.spyOn(InvitationLink, "getForTeamMember").mockResolvedValue({
    link: REGISTRATION_LINK,
    isRegistered: false,
    isAccepted: false,
    email: "pending@example.com",
  });
  getNotSignedUp = jest
    .spyOn(InvitationLink, "getMembershipsNotSignedUp")
    .mockResolvedValue([TEAM_MEMBER_ID]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /team-member/invitation-link is refused to anybody but a master admin", () => {
  test.each([
    ["nobody signed in", { kind: "none" } as RequestSession, 401],
    [
      "a token that does not verify",
      { kind: "invalid", error: new Error("bad token") } as RequestSession,
      401,
    ],
    [
      "a blocked master admin",
      { kind: "blocked", session: session(true) } as RequestSession,
      401,
    ],
    [
      "a signed-in Project Owner who is not a master admin",
      { kind: "user", session: session(false) } as RequestSession,
      422,
    ],
  ])(
    "%s: refused, and no link is read or minted",
    async (_who: string, answer: RequestSession, status: number) => {
      sessionIs(answer);

      const result: HttpResult = await postInvitationLink(port, {
        teamMemberId: TEAM_MEMBER_ID.toString(),
      });

      expect(result.status).toBe(status);
      expect(getLink).not.toHaveBeenCalled();
      expect(result.raw).not.toContain("token=");
      expect(result.raw).not.toContain("/accounts/register");
    },
  );

  test("a master admin is handed the link of the membership they asked for", async () => {
    sessionIs({ kind: "user", session: session(true) });

    const result: HttpResult = await postInvitationLink(port, {
      teamMemberId: TEAM_MEMBER_ID.toString(),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      link: REGISTRATION_LINK,
      isRegistered: false,
      isAccepted: false,
      email: "pending@example.com",
    });
    expect(getLink).toHaveBeenCalledTimes(1);
    expect(getLink.mock.calls[0]![0].toString()).toBe(
      TEAM_MEMBER_ID.toString(),
    );
  });

  test("a master admin's request with no membership id reads nothing", async () => {
    sessionIs({ kind: "user", session: session(true) });

    const result: HttpResult = await postInvitationLink(port, {});

    expect(result.status).toBe(400);
    expect(getLink).not.toHaveBeenCalled();
  });
});

/*
 * THE LINK OF AN INVITATION EMAIL THE SERVER FAILED TO SEND (#7169).
 *
 * The server's email log knows a failed invitation by its project and the
 * address it went to, and its row offers Get Invitation Link: the route
 * takes those in place of a membership - for a master admin alone, as
 * ever. Anything that is not a project and an address reads nothing.
 */
describe("POST /team-member/invitation-link by a project and the address an invitation went to", () => {
  const PROJECT_ID: string = "71690000-0000-4000-8000-0000000000c1";
  const INVITEE: string = "pending@example.com";

  let getForInvitee: SpyInstance<typeof InvitationLink.getForProjectInvitee>;

  beforeEach(() => {
    getForInvitee = jest
      .spyOn(InvitationLink, "getForProjectInvitee")
      .mockResolvedValue({
        link: REGISTRATION_LINK,
        isRegistered: false,
        isAccepted: false,
        email: INVITEE,
      });
  });

  test("a master admin is handed the link of that person's invitation to that project", async () => {
    sessionIs({ kind: "user", session: session(true) });

    const result: HttpResult = await postInvitationLink(port, {
      projectId: PROJECT_ID,
      email: ` ${INVITEE} `,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      link: REGISTRATION_LINK,
      isRegistered: false,
      isAccepted: false,
      email: INVITEE,
    });
    expect(getForInvitee).toHaveBeenCalledTimes(1);

    const asked: { projectId: ObjectID; email: Email } = getForInvitee.mock
      .calls[0]![0] as { projectId: ObjectID; email: Email };

    expect(asked.projectId.toString()).toBe(PROJECT_ID);
    expect(asked.email.toString()).toBe(INVITEE);
    expect(getLink).not.toHaveBeenCalled();
  });

  test.each([
    ["a signed-in Project Owner who is not a master admin", false, 422],
  ])(
    "%s: refused, and no link is read or minted",
    async (_who: string, isMasterAdmin: boolean, status: number) => {
      sessionIs({ kind: "user", session: session(isMasterAdmin) });

      const result: HttpResult = await postInvitationLink(port, {
        projectId: PROJECT_ID,
        email: INVITEE,
      });

      expect(result.status).toBe(status);
      expect(getForInvitee).not.toHaveBeenCalled();
      expect(result.raw).not.toContain("token=");
    },
  );

  test.each([
    ["a project that is not one", { projectId: "walk-co", email: INVITEE }],
    ["an address that is not one", { projectId: PROJECT_ID, email: "grace" }],
    ["no address", { projectId: PROJECT_ID }],
    ["no project", { email: INVITEE }],
  ])("%s reads nothing", async (_case: string, body: JSONObject) => {
    sessionIs({ kind: "user", session: session(true) });

    const result: HttpResult = await postInvitationLink(port, body);

    expect(result.status).toBe(400);
    expect(getForInvitee).not.toHaveBeenCalled();
    expect(getLink).not.toHaveBeenCalled();
  });

  test("a membership named alongside wins: the row of a list asks by its membership", async () => {
    sessionIs({ kind: "user", session: session(true) });

    await postInvitationLink(port, {
      teamMemberId: TEAM_MEMBER_ID.toString(),
      projectId: PROJECT_ID,
      email: INVITEE,
    });

    expect(getLink).toHaveBeenCalledTimes(1);
    expect(getForInvitee).not.toHaveBeenCalled();
  });
});

/*
 * WHO MAY ASK WHICH MEMBERS HAVE NOT SIGNED UP (#8191).
 *
 * The lists ask, for their accepted rows, whose person has no account yet,
 * to offer that person's sign-up link. Whether somebody has signed up is
 * about their account, so only a master admin - who is handed the link
 * itself - may ask.
 */
const NOT_SIGNED_UP: string = "/api/team-member/not-signed-up";

describe("POST /team-member/not-signed-up is refused to anybody but a master admin", () => {
  test.each([
    ["nobody signed in", { kind: "none" } as RequestSession, 401],
    [
      "a token that does not verify",
      { kind: "invalid", error: new Error("bad token") } as RequestSession,
      401,
    ],
    [
      "a blocked master admin",
      { kind: "blocked", session: session(true) } as RequestSession,
      401,
    ],
    [
      "a signed-in Project Owner who is not a master admin",
      { kind: "user", session: session(false) } as RequestSession,
      422,
    ],
  ])(
    "%s: refused, and nothing is read",
    async (_who: string, answer: RequestSession, status: number) => {
      sessionIs(answer);

      const result: HttpResult = await postInvitationLink(
        port,
        { teamMemberIds: [TEAM_MEMBER_ID.toString()] },
        NOT_SIGNED_UP,
      );

      expect(result.status).toBe(status);
      expect(getNotSignedUp).not.toHaveBeenCalled();
      expect(result.raw).not.toContain(TEAM_MEMBER_ID.toString());
    },
  );

  test("a master admin is told which of the memberships they named have not signed up", async () => {
    sessionIs({ kind: "user", session: session(true) });

    const other: string = "71680000-0000-4000-8000-0000000000a2";
    const result: HttpResult = await postInvitationLink(
      port,
      { teamMemberIds: [TEAM_MEMBER_ID.toString(), other] },
      NOT_SIGNED_UP,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      teamMemberIds: [TEAM_MEMBER_ID.toString()],
    });
    expect(
      getNotSignedUp.mock.calls[0]![0].map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([TEAM_MEMBER_ID.toString(), other]);
    // Never anything about a password.
    expect(result.raw).not.toMatch(/password/i);
  });

  test("a membership named twice is asked about once", async () => {
    sessionIs({ kind: "user", session: session(true) });

    await postInvitationLink(
      port,
      {
        teamMemberIds: [TEAM_MEMBER_ID.toString(), TEAM_MEMBER_ID.toString()],
      },
      NOT_SIGNED_UP,
    );

    expect(getNotSignedUp.mock.calls[0]![0]).toHaveLength(1);
  });

  test.each([
    ["no list", {}],
    ["a list that is not one", { teamMemberIds: "not-a-list" }],
    ["an id that is not one", { teamMemberIds: ["not-an-id"] }],
    ["a number for an id", { teamMemberIds: [7] }],
  ] as Array<[string, JSONObject]>)(
    "a master admin's request with %s reads nothing",
    async (_what: string, body: JSONObject) => {
      sessionIs({ kind: "user", session: session(true) });

      const result: HttpResult = await postInvitationLink(
        port,
        body,
        NOT_SIGNED_UP,
      );

      expect(result.status).toBe(400);
      expect(getNotSignedUp).not.toHaveBeenCalled();
    },
  );

  test("more than a list's page of memberships is refused", async () => {
    sessionIs({ kind: "user", session: session(true) });

    const result: HttpResult = await postInvitationLink(
      port,
      {
        teamMemberIds: Array.from({ length: 101 }, (): string => {
          return ObjectID.generate().toString();
        }),
      },
      NOT_SIGNED_UP,
    );

    expect(result.status).toBe(400);
    expect(getNotSignedUp).not.toHaveBeenCalled();
  });

  test("an empty list is no one to ask about", async () => {
    sessionIs({ kind: "user", session: session(true) });
    getNotSignedUp.mockResolvedValue([]);

    const result: HttpResult = await postInvitationLink(
      port,
      { teamMemberIds: [] },
      NOT_SIGNED_UP,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ teamMemberIds: [] });
  });
});
