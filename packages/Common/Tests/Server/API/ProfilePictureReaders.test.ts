import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import UserAPI from "../../../Server/API/UserAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UserService from "../../../Server/Services/UserService";
import Response from "../../../Server/Utils/Response";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import PendingInviteeProfiles from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import File from "../../../Models/DatabaseModels/File";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import MimeType from "../../../Types/File/MimeType";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * WHO SEES A PERSON'S PICTURE (#9823): GET /api/user/profile-picture/:userId.
 *
 * Every avatar on the Dashboard is drawn from this route, by the person's
 * id, and it answered whoever asked. A project knows the ids of the people
 * it has invited, so the Users list drew an invitee's own picture before
 * they accepted - one more way an invitation said the address had an
 * account. Now the picture is served to the person, to a master admin and
 * to the people of a project the person has joined; everyone else - a
 * project that has only invited them, and anyone not signed in - gets the
 * blank picture a person with none has, and the picture is never read for
 * them.
 */

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

const PERSON_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const READER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const PICTURE: Buffer = Buffer.from("their-own-picture");
const BLANK: string = "blank-picture";

interface HttpResult {
  status: number;
  text: string;
}

function get(port: number, path: string): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const request: http.ClientRequest = http.request(
        { host: "127.0.0.1", port: port, path: path, method: "GET" },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              text: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

function session(userId: ObjectID, isMasterAdmin: boolean): JSONWebTokenData {
  return {
    userId: userId,
    email: new Email("reader@company.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

describe("a person's picture is shown to those who know them", () => {
  let server: http.Server;
  let port: number;
  let pictureReads: number = 0;
  let sharesJoinedProject: boolean = false;

  beforeAll(async () => {
    jest
      .spyOn(Response, "sendFileByPath")
      .mockImplementation(
        (_req: ExpressRequest, res: ExpressResponse): void => {
          res.status(200).send(BLANK);
        },
      );

    jest.spyOn(UserService, "findOneBy").mockImplementation((async () => {
      pictureReads++;

      const file: File = new File();
      file._id = "f0000000-0000-4000-8000-000000000001";
      file.file = PICTURE;
      file.fileType = MimeType.png;
      file.name = "picture.png";
      file.createdByUserId = PERSON_ID;

      const user: User = new User();
      user._id = PERSON_ID.toString();
      user.profilePictureFile = file;
      return user;
    }) as never);

    jest
      .spyOn(PendingInviteeProfiles, "sharesJoinedProject")
      .mockImplementation(async () => {
        return sharesJoinedProject;
      });

    const app: express.Express = express();
    app.use(CookieParser());
    app.use("/api", new UserAPI().getRouter());
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    pictureReads = 0;
    sharesJoinedProject = false;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });

    jest.restoreAllMocks();
  });

  const path: string = `/api/user/profile-picture/${PERSON_ID.toString()}`;

  it("nobody signed in gets the blank picture, and the picture is never read", async () => {
    jest.spyOn(UserMiddleware, "getSessionUser").mockResolvedValue(null);

    const result: HttpResult = await get(port, path);

    expect(result.status).toBe(200);
    expect(result.text).toBe(BLANK);
    expect(pictureReads).toBe(0);
  });

  it("a project that has only invited the person gets the blank picture: alike whether they have one or not", async () => {
    jest
      .spyOn(UserMiddleware, "getSessionUser")
      .mockResolvedValue(session(READER_ID, false));
    sharesJoinedProject = false;

    const result: HttpResult = await get(port, path);

    expect(result.status).toBe(200);
    expect(result.text).toBe(BLANK);
    expect(pictureReads).toBe(0);
  });

  it("the people of a project the person has joined see it", async () => {
    jest
      .spyOn(UserMiddleware, "getSessionUser")
      .mockResolvedValue(session(READER_ID, false));
    sharesJoinedProject = true;

    const result: HttpResult = await get(port, path);

    expect(result.status).toBe(200);
    expect(result.text).toBe(PICTURE.toString("utf8"));
  });

  it.each([
    ["the person themselves", PERSON_ID, false],
    ["a master admin", READER_ID, true],
  ])(
    "%s sees it",
    async (_case: string, readerId: ObjectID, isMasterAdmin: boolean) => {
      jest
        .spyOn(UserMiddleware, "getSessionUser")
        .mockResolvedValue(session(readerId, isMasterAdmin));

      const result: HttpResult = await get(port, path);

      expect(result.text).toBe(PICTURE.toString("utf8"));
    },
  );
});
