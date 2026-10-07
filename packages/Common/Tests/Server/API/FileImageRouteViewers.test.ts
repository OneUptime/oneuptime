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
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import FileAPI from "../../../Server/API/FileAPI";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import FileService from "../../../Server/Services/FileService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import File from "../../../Models/DatabaseModels/File";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../../Models/DatabaseModels/User";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A real Express app: an error that walks the routes registered after the
 * one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose. Lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * WHO AN IMAGE ROUTE SERVES A FILE TO.
 *
 * The image routes answer by the file alone - an inline image's access
 * token, a public icon's id - so they decide themselves who may see it
 * (FileViewerAccess):
 *
 *   - a public image: anyone;
 *   - a private image of a project: the people who can open the project now
 *     (an accepted membership, the project's SSO rule met), and server
 *     admins;
 *   - a private image with no project: the person who uploaded it, and
 *     server admins;
 *   - by id: public files only, whoever asks.
 *
 * Everyone else gets exactly the answer a missing file gets.
 *
 * Driven through a real Express app with the production error handler and
 * real, signed session tokens; only the data layer is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
// A project that requires SSO to sign in.
const SSO_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
// The SAML provider members of the SSO project sign in with.
const SSO_PROVIDER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
// Whether that provider is on: turning it off ends the sign-ins it gave.
let ssoProviderIsOn: boolean = true;

// A member of PROJECT_ID (and of the SSO project).
const MEMBER_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000001",
);
// A member of OTHER_PROJECT_ID only.
const OUTSIDER_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000002",
);
// A server admin, member of no project.
const ADMIN_ID: ObjectID = new ObjectID("a0000000-0000-4000-8000-000000000003");
// A member of PROJECT_ID whose account is blocked.
const BLOCKED_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000004",
);
// The person who uploaded the image that has no project.
const UPLOADER_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000005",
);

const MEMBERSHIPS: Dictionary<Array<string>> = {
  [PROJECT_ID.toString()]: [MEMBER_ID.toString(), BLOCKED_ID.toString()],
  [OTHER_PROJECT_ID.toString()]: [OUTSIDER_ID.toString()],
  [SSO_PROJECT_ID.toString()]: [MEMBER_ID.toString()],
};

interface FileFixture {
  id: string;
  token: string;
  bytes: string;
  isPublic: unknown;
  projectId: ObjectID | null;
  createdByUserId: ObjectID | null;
}

const PUBLIC_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000001",
  token: "a1".repeat(32),
  bytes: "public-image",
  isPublic: true,
  projectId: PROJECT_ID,
  createdByUserId: MEMBER_ID,
};

const PRIVATE_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000002",
  token: "b2".repeat(32),
  bytes: "private-image",
  isPublic: false,
  projectId: PROJECT_ID,
  createdByUserId: MEMBER_ID,
};

const SSO_PROJECT_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000003",
  token: "c3".repeat(32),
  bytes: "sso-project-image",
  isPublic: false,
  projectId: SSO_PROJECT_ID,
  createdByUserId: MEMBER_ID,
};

const UNOWNED_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000004",
  token: "d4".repeat(32),
  bytes: "unowned-image",
  isPublic: false,
  projectId: null,
  createdByUserId: UPLOADER_ID,
};

// Uploaded before files recorded their project or uploader.
const LEGACY_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000005",
  token: "e5".repeat(32),
  bytes: "legacy-image",
  isPublic: false,
  projectId: null,
  createdByUserId: null,
};

// isPublic as the varchar era stored it: the STRING "false".
const LOOSE_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000006",
  token: "f6".repeat(32),
  bytes: "loose-image",
  isPublic: "false",
  projectId: PROJECT_ID,
  createdByUserId: MEMBER_ID,
};

/*
 * An image in the description of an announcement of PROJECT_ID: private
 * until the announcement is shown (PublishedImages), which no write marks -
 * the first request for it once the announcement's time has come makes it
 * public.
 */
const ANNOUNCEMENT_IMAGE: FileFixture = {
  id: "f0000000-0000-4000-8000-000000000007",
  token: "a7".repeat(32),
  bytes: "announcement-image",
  isPublic: false,
  projectId: PROJECT_ID,
  createdByUserId: MEMBER_ID,
};

const FIXTURES: Array<FileFixture> = [
  PUBLIC_IMAGE,
  PRIVATE_IMAGE,
  SSO_PROJECT_IMAGE,
  UNOWNED_IMAGE,
  LEGACY_IMAGE,
  LOOSE_IMAGE,
  ANNOUNCEMENT_IMAGE,
];

/*
 * A fresh row for every read: a route may change what it is handed. The
 * bytes come back only when the read selected them, as Postgres would.
 */
function fileOf(
  fixture: FileFixture | undefined,
  select: Dictionary<unknown>,
): File | null {
  if (!fixture) {
    return null;
  }

  const file: File = new File();
  file._id = fixture.id;

  if (select["file"]) {
    file.file = Buffer.from(fixture.bytes);
  }

  file.fileType = MimeType.png;
  file.name = "image.png";
  (file as unknown as { isPublic: unknown }).isPublic = fixture.isPublic;

  if (fixture.projectId) {
    file.projectId = fixture.projectId;
  }

  if (fixture.createdByUserId) {
    file.createdByUserId = fixture.createdByUserId;
  }

  return file;
}

function user(userId: ObjectID): User {
  const person: User = new User();
  person.id = userId;
  person.name = new Name("Viewer");
  person.email = new Email("viewer@example.com");
  return person;
}

// A dashboard session's access token, as a login signs it.
function sessionToken(
  userId: ObjectID,
  options: { isMasterAdmin?: boolean; expiresInSeconds?: number } = {},
): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email("viewer@example.com"),
      name: new Name("Viewer"),
      timezone: null,
      isMasterAdmin: options.isMasterAdmin === true,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: options.expiresInSeconds ?? 900,
  });
}

// A status page visitor's own session: it signs in to one status page.
function statusPageVisitorToken(userId: ObjectID): string {
  const visitor: StatusPagePrivateUser = new StatusPagePrivateUser();
  visitor.id = userId;
  visitor.email = new Email("visitor@example.com");
  visitor.statusPageId = ObjectID.generate();

  return JSONWebToken.sign({ data: visitor, expiresInSeconds: 900 });
}

type HttpResult = {
  status: number;
  text: string;
  body: JSONObject | null;
  headers: http.IncomingHttpHeaders;
};

function get(data: {
  port: number;
  path: string;
  cookies?: Dictionary<string>;
  bearer?: string;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const headers: http.OutgoingHttpHeaders = {};

      const cookies: Array<string> = Object.entries(data.cookies || {}).map(
        ([name, value]: [string, string]): string => {
          return `${name}=${value}`;
        },
      );

      if (cookies.length > 0) {
        headers["cookie"] = cookies.join("; ");
      }

      if (data.bearer) {
        headers["authorization"] = `Bearer ${data.bearer}`;
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "GET",
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = text ? (JSON.parse(text) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({
              status: response.statusCode || 0,
              text,
              body,
              headers: response.headers,
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

describe("the image routes serve a file only to the people who may see it", () => {
  let server: http.Server;
  let port: number;
  let blocked: Set<string> = new Set<string>();
  let failMembershipLookups: boolean = false;
  // When the announcement ANNOUNCEMENT_IMAGE is in is shown from.
  let announcementShownFrom: Date = new Date(Date.now() + 60 * 60 * 1000);
  // Each question the route asked of whether a record shows a file now.
  let shownAsks: Array<string> = [];
  // Every read of a file: how it asked, and whether it came back with bytes.
  let reads: Array<{ query: Dictionary<unknown>; gotBytes: boolean }> = [];

  // Whether any read so far came back with a file's bytes.
  const readAnyBytes: () => boolean = (): boolean => {
    return reads.some((read: { gotBytes: boolean }): boolean => {
      return read.gotBytes;
    });
  };

  beforeAll(async () => {
    /*
     * By access token or by id - and, when the read asks, only a file that
     * is exactly public, as Postgres compares a boolean column.
     */
    jest.spyOn(FileService, "findOneBy").mockImplementation((async (data: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }) => {
      const found: FileFixture | undefined = FIXTURES.find(
        (fixture: FileFixture): boolean => {
          const named: boolean =
            data.query["imageAccessToken"] !== undefined
              ? fixture.token === data.query["imageAccessToken"]
              : fixture.id === String(data.query["_id"]);

          return (
            named &&
            (data.query["isPublic"] === undefined ||
              fixture.isPublic === data.query["isPublic"])
          );
        },
      );

      reads.push({
        query: data.query,
        gotBytes: Boolean(found && data.select["file"]),
      });

      return fileOf(found, data.select);
    }) as never);

    jest.spyOn(UserService, "isUserBlocked").mockImplementation((async (
      userId: ObjectID,
    ) => {
      return blocked.has(userId.toString());
    }) as never);

    /*
     * The database's answer to whether a record shows a file now, as one
     * statement makes it public (PublishedImages.publishWhenShown, held to
     * Postgres by PublishedImagesPostgres): only the announcement's image,
     * once its time has come.
     */
    jest.spyOn(PublishedImages, "publishWhenShown").mockImplementation((async (
      file: { _id?: unknown } | null | undefined,
      now?: Date,
    ): Promise<boolean> => {
      shownAsks.push(String(file?._id));

      // Shown now: public, made so now or by a request at the same moment.
      if (
        String(file?._id) !== ANNOUNCEMENT_IMAGE.id ||
        (now || new Date()).getTime() < announcementShownFrom.getTime()
      ) {
        return false;
      }

      ANNOUNCEMENT_IMAGE.isPublic = true;
      return true;
    }) as never);

    // An accepted membership is a permission set; anyone else gets none.
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockImplementation((async (userId: ObjectID, projectId: ObjectID) => {
        if (failMembershipLookups) {
          throw new Error("the database is unreachable");
        }

        const members: Array<string> = MEMBERSHIPS[projectId.toString()] || [];

        return members.includes(userId.toString())
          ? ({
              projectId: projectId,
              permissions: [],
              isBlockPermission: false,
            } as unknown as UserTenantAccessPermission)
          : null;
      }) as never);

    jest
      .spyOn(ProjectService, "getRequireSsoForLogin")
      .mockImplementation((async (projectId: ObjectID) => {
        return projectId.toString() === SSO_PROJECT_ID.toString();
      }) as never);
    jest
      .spyOn(ProjectService, "getRequireSsoWithSsoProviderId")
      .mockResolvedValue(null as never);
    jest
      .spyOn(GlobalConfigService, "getRequireSsoForLogin")
      .mockResolvedValue(false as never);
    jest
      .spyOn(ProjectSsoService, "getSignInStanding")
      .mockImplementation((async (data: {
        providerId: ObjectID;
        projectId: ObjectID;
      }) => {
        return {
          isOn:
            ssoProviderIsOn &&
            data.providerId.toString() === SSO_PROVIDER_ID.toString() &&
            data.projectId.toString() === SSO_PROJECT_ID.toString(),
          signInsEndedAtMs: null,
        };
      }) as never);

    const app: express.Express = express();
    app.use(CookieParser());
    app.use("/api", new FileAPI().getRouter());
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    blocked = new Set<string>([BLOCKED_ID.toString()]);
    ssoProviderIsOn = true;
    failMembershipLookups = false;
    (FileService.findOneBy as unknown as jest.Mock).mockClear();
    reads = [];
    ANNOUNCEMENT_IMAGE.isPublic = false;
    announcementShownFrom = new Date(Date.now() + 60 * 60 * 1000);
    shownAsks = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });

    jest.restoreAllMocks();
  });

  const tokenPath: (fixture: FileFixture) => string = (
    fixture: FileFixture,
  ): string => {
    return `/api/file/image/access-token/${fixture.token}`;
  };

  const idPath: (fixture: FileFixture) => string = (
    fixture: FileFixture,
  ): string => {
    return `/api/file/image/${fixture.id}`;
  };

  const asSession: (userId: ObjectID) => Dictionary<string> = (
    userId: ObjectID,
  ): Dictionary<string> => {
    return { [CookieUtil.getUserTokenKey()]: sessionToken(userId) };
  };

  const asAdmin: () => Dictionary<string> = (): Dictionary<string> => {
    return {
      [CookieUtil.getUserTokenKey()]: sessionToken(ADMIN_ID, {
        isMasterAdmin: true,
      }),
    };
  };

  // What a token that matches no file is answered with.
  const missingFileAnswer: () => Promise<HttpResult> =
    async (): Promise<HttpResult> => {
      return await get({
        port,
        path: `/api/file/image/access-token/${"0".repeat(64)}`,
      });
    };

  function expectServed(result: HttpResult, fixture: FileFixture): void {
    expect({ status: result.status, text: result.text }).toEqual({
      status: 200,
      text: fixture.bytes,
    });
  }

  async function expectRefusedLikeMissing(
    result: HttpResult,
    fixture: FileFixture,
  ): Promise<void> {
    const missing: HttpResult = await missingFileAnswer();

    expect(result.status).toBe(404);
    expect(result.text).not.toContain(fixture.bytes);
    // Word for word what a file that does not exist gets.
    expect(result.body).toEqual(missing.body);
  }

  describe("a public image, by its access token", () => {
    it("is served to anyone, signed in or not", async () => {
      for (const cookies of [
        {},
        asSession(MEMBER_ID),
        asSession(OUTSIDER_ID),
        asAdmin(),
      ]) {
        expectServed(
          await get({ port, path: tokenPath(PUBLIC_IMAGE), cookies }),
          PUBLIC_IMAGE,
        );
      }
    });

    it("is cached as it always was", async () => {
      const result: HttpResult = await get({
        port,
        path: tokenPath(PUBLIC_IMAGE),
      });

      expect(result.headers["cache-control"]).toBeUndefined();
    });

    it("is read whole in one read, which asks only for a public file", async () => {
      await get({ port, path: tokenPath(PUBLIC_IMAGE) });

      expect(reads).toEqual([
        {
          query: { imageAccessToken: PUBLIC_IMAGE.token, isPublic: true },
          gotBytes: true,
        },
      ]);
    });
  });

  describe("a private image of a project, by its access token", () => {
    it("is served to a member of the project, from the session cookie", async () => {
      expectServed(
        await get({
          port,
          path: tokenPath(PRIVATE_IMAGE),
          cookies: asSession(MEMBER_ID),
        }),
        PRIVATE_IMAGE,
      );
    });

    it("is served to a member of the project, from the mobile app's bearer token", async () => {
      expectServed(
        await get({
          port,
          path: tokenPath(PRIVATE_IMAGE),
          bearer: sessionToken(MEMBER_ID),
        }),
        PRIVATE_IMAGE,
      );
    });

    it("is served to a server admin who is in no project", async () => {
      expectServed(
        await get({ port, path: tokenPath(PRIVATE_IMAGE), cookies: asAdmin() }),
        PRIVATE_IMAGE,
      );
    });

    it("is kept by no cache between the viewer and OneUptime", async () => {
      const result: HttpResult = await get({
        port,
        path: tokenPath(PRIVATE_IMAGE),
        cookies: asSession(MEMBER_ID),
      });

      expect(result.headers["cache-control"]).toBe("private, no-cache");
    });

    it("is answered like a missing file without a session", async () => {
      await expectRefusedLikeMissing(
        await get({ port, path: tokenPath(PRIVATE_IMAGE) }),
        PRIVATE_IMAGE,
      );
    });

    it("is answered like a missing file to someone signed in to another project", async () => {
      await expectRefusedLikeMissing(
        await get({
          port,
          path: tokenPath(PRIVATE_IMAGE),
          cookies: asSession(OUTSIDER_ID),
        }),
        PRIVATE_IMAGE,
      );
    });

    it("is answered like a missing file to a member whose account is blocked", async () => {
      await expectRefusedLikeMissing(
        await get({
          port,
          path: tokenPath(PRIVATE_IMAGE),
          cookies: asSession(BLOCKED_ID),
        }),
        PRIVATE_IMAGE,
      );

      // The same person, unblocked, sees it.
      blocked.clear();
      expectServed(
        await get({
          port,
          path: tokenPath(PRIVATE_IMAGE),
          cookies: asSession(BLOCKED_ID),
        }),
        PRIVATE_IMAGE,
      );
    });

    it("is answered like a missing file to a status page visitor's own session", async () => {
      for (const transport of ["cookie", "bearer"]) {
        const token: string = statusPageVisitorToken(MEMBER_ID);

        await expectRefusedLikeMissing(
          await get({
            port,
            path: tokenPath(PRIVATE_IMAGE),
            ...(transport === "cookie"
              ? { cookies: { [CookieUtil.getUserTokenKey()]: token } }
              : { bearer: token }),
          }),
          PRIVATE_IMAGE,
        );
      }
    });

    it("is answered like a missing file to a session that has expired or was not signed by OneUptime", async () => {
      const expired: string = sessionToken(MEMBER_ID, {
        expiresInSeconds: -60,
      });
      const forged: string = jwt.sign(
        { userId: MEMBER_ID.toString(), isMasterAdmin: true },
        `not-${EncryptionSecret.toString()}`,
        { expiresIn: 900 },
      );

      for (const token of [expired, forged, "not-a-token"]) {
        await expectRefusedLikeMissing(
          await get({
            port,
            path: tokenPath(PRIVATE_IMAGE),
            cookies: { [CookieUtil.getUserTokenKey()]: token },
          }),
          PRIVATE_IMAGE,
        );
      }
    });

    it("is answered like a missing file when who may see it cannot be decided", async () => {
      failMembershipLookups = true;

      await expectRefusedLikeMissing(
        await get({
          port,
          path: tokenPath(PRIVATE_IMAGE),
          cookies: asSession(MEMBER_ID),
        }),
        PRIVATE_IMAGE,
      );
    });

    it("is never read for someone who may not see it: only who it belongs to is", async () => {
      for (const cookies of [{}, asSession(OUTSIDER_ID)]) {
        reads = [];

        await get({ port, path: tokenPath(PRIVATE_IMAGE), cookies });

        expect(reads.length).toBeGreaterThan(0);
        expect(readAnyBytes()).toBe(false);
      }
    });

    it("is read whole only once it may be served", async () => {
      await get({
        port,
        path: tokenPath(PRIVATE_IMAGE),
        cookies: asSession(MEMBER_ID),
      });

      expect(reads).toEqual([
        // Not a public file: nothing comes back.
        {
          query: { imageAccessToken: PRIVATE_IMAGE.token, isPublic: true },
          gotBytes: false,
        },
        // Who it belongs to, to decide.
        { query: { imageAccessToken: PRIVATE_IMAGE.token }, gotBytes: false },
        // Then, for a member, the file itself.
        { query: { _id: PRIVATE_IMAGE.id }, gotBytes: true },
      ]);
    });

    it("stays private when isPublic holds anything but true", async () => {
      await expectRefusedLikeMissing(
        await get({ port, path: tokenPath(LOOSE_IMAGE) }),
        LOOSE_IMAGE,
      );

      expectServed(
        await get({
          port,
          path: tokenPath(LOOSE_IMAGE),
          cookies: asSession(MEMBER_ID),
        }),
        LOOSE_IMAGE,
      );
    });
  });

  describe("a private image of a project that requires SSO", () => {
    it("is answered like a missing file to a member who has not signed in with SSO", async () => {
      await expectRefusedLikeMissing(
        await get({
          port,
          path: tokenPath(SSO_PROJECT_IMAGE),
          cookies: asSession(MEMBER_ID),
        }),
        SSO_PROJECT_IMAGE,
      );
    });

    it("is served to the same member once they have signed in to the project with SSO", async () => {
      const ssoToken: string = CookieUtil.getSSOToken({
        user: user(MEMBER_ID),
        projectId: SSO_PROJECT_ID,
        ssoProviderId: SSO_PROVIDER_ID,
        ssoProviderType: SsoProviderType.ProjectSSO,
      });

      expectServed(
        await get({
          port,
          path: tokenPath(SSO_PROJECT_IMAGE),
          cookies: {
            ...asSession(MEMBER_ID),
            [CookieUtil.getUserSSOKey(SSO_PROJECT_ID)]: ssoToken,
          },
        }),
        SSO_PROJECT_IMAGE,
      );
    });

    it("is answered like a missing file once the provider that signed them in is turned off", async () => {
      const ssoToken: string = CookieUtil.getSSOToken({
        user: user(MEMBER_ID),
        projectId: SSO_PROJECT_ID,
        ssoProviderId: SSO_PROVIDER_ID,
        ssoProviderType: SsoProviderType.ProjectSSO,
      });

      ssoProviderIsOn = false;

      await expectRefusedLikeMissing(
        await get({
          port,
          path: tokenPath(SSO_PROJECT_IMAGE),
          cookies: {
            ...asSession(MEMBER_ID),
            [CookieUtil.getUserSSOKey(SSO_PROJECT_ID)]: ssoToken,
          },
        }),
        SSO_PROJECT_IMAGE,
      );
    });

    it("does not let another project's SSO sign-in stand in for it", async () => {
      const otherSsoToken: string = CookieUtil.getSSOToken({
        user: user(MEMBER_ID),
        projectId: PROJECT_ID,
        ssoProviderId: SSO_PROVIDER_ID,
        ssoProviderType: SsoProviderType.ProjectSSO,
      });

      await expectRefusedLikeMissing(
        await get({
          port,
          path: tokenPath(SSO_PROJECT_IMAGE),
          cookies: {
            ...asSession(MEMBER_ID),
            [CookieUtil.getUserSSOKey(PROJECT_ID)]: otherSsoToken,
          },
        }),
        SSO_PROJECT_IMAGE,
      );
    });
  });

  describe("a private image uploaded outside any project", () => {
    it("is served to the person who uploaded it", async () => {
      expectServed(
        await get({
          port,
          path: tokenPath(UNOWNED_IMAGE),
          cookies: asSession(UPLOADER_ID),
        }),
        UNOWNED_IMAGE,
      );
    });

    it("is served to a server admin", async () => {
      expectServed(
        await get({ port, path: tokenPath(UNOWNED_IMAGE), cookies: asAdmin() }),
        UNOWNED_IMAGE,
      );
    });

    it("is answered like a missing file to anyone else, members of any project included", async () => {
      for (const cookies of [
        {},
        asSession(MEMBER_ID),
        asSession(OUTSIDER_ID),
      ]) {
        await expectRefusedLikeMissing(
          await get({ port, path: tokenPath(UNOWNED_IMAGE), cookies }),
          UNOWNED_IMAGE,
        );
      }
    });

    it("with no uploader on record, is served to server admins only", async () => {
      for (const cookies of [
        {},
        asSession(MEMBER_ID),
        asSession(UPLOADER_ID),
      ]) {
        await expectRefusedLikeMissing(
          await get({ port, path: tokenPath(LEGACY_IMAGE), cookies }),
          LEGACY_IMAGE,
        );
      }

      expectServed(
        await get({ port, path: tokenPath(LEGACY_IMAGE), cookies: asAdmin() }),
        LEGACY_IMAGE,
      );
    });
  });

  describe("an image by its id", () => {
    it("is served when it is public, to anyone", async () => {
      for (const cookies of [{}, asSession(OUTSIDER_ID)]) {
        const result: HttpResult = await get({
          port,
          path: idPath(PUBLIC_IMAGE),
          cookies,
        });

        expectServed(result, PUBLIC_IMAGE);
        expect(result.headers["cache-control"]).toBeUndefined();
      }
    });

    it("is never served when it is private, whoever asks - an id is no secret", async () => {
      for (const fixture of [PRIVATE_IMAGE, UNOWNED_IMAGE, LOOSE_IMAGE]) {
        for (const cookies of [
          {},
          asSession(MEMBER_ID),
          asSession(UPLOADER_ID),
          asAdmin(),
        ]) {
          const result: HttpResult = await get({
            port,
            path: idPath(fixture),
            cookies,
          });

          expect(result.status).toBe(404);
          expect(result.text).not.toContain(fixture.bytes);
        }
      }
    });

    it("answers an id that is not one without asking the database", async () => {
      for (const id of [
        "not-an-id",
        "1",
        "f0000000-0000-4000-8000-00000000000",
      ]) {
        const result: HttpResult = await get({
          port,
          path: `/api/file/image/${id}`,
        });

        expect(result.status).toBe(404);
      }

      expect(reads).toEqual([]);
    });

    it("never reads a private file's bytes: its one read asks for a public file", async () => {
      const result: HttpResult = await get({
        port,
        path: idPath(PRIVATE_IMAGE),
        cookies: asAdmin(),
      });

      expect(result.status).toBe(404);
      expect(reads).toHaveLength(1);
      expect(
        (FileService.findOneBy as unknown as jest.Mock).mock.calls[0]![0],
      ).toMatchObject({ query: { isPublic: true } });
      // ...and found none, so no bytes came back.
      expect(
        await (FileService.findOneBy as unknown as jest.Mock).mock.results[0]!
          .value,
      ).toBeNull();
    });
  });

  describe("an image in an announcement scheduled for later", () => {
    it("is answered like a missing file before the announcement is shown, to everyone outside the project", async () => {
      for (const cookies of [
        {},
        asSession(OUTSIDER_ID),
        {
          [CookieUtil.getUserTokenKey()]: statusPageVisitorToken(MEMBER_ID),
        },
      ]) {
        await expectRefusedLikeMissing(
          await get({ port, path: tokenPath(ANNOUNCEMENT_IMAGE), cookies }),
          ANNOUNCEMENT_IMAGE,
        );
      }

      expect(ANNOUNCEMENT_IMAGE.isPublic).toBe(false);
    });

    it("is served to the project's members before then, and stays private", async () => {
      const result: HttpResult = await get({
        port,
        path: tokenPath(ANNOUNCEMENT_IMAGE),
        cookies: asSession(MEMBER_ID),
      });

      expectServed(result, ANNOUNCEMENT_IMAGE);
      expect(result.headers["cache-control"]).toBe("private, no-cache");
      expect(ANNOUNCEMENT_IMAGE.isPublic).toBe(false);
      expect(shownAsks).toEqual([]);
    });

    it("is served to everyone once the announcement is shown, and is public from then on", async () => {
      announcementShownFrom = new Date(Date.now() - 1000);

      const first: HttpResult = await get({
        port,
        path: tokenPath(ANNOUNCEMENT_IMAGE),
      });

      expectServed(first, ANNOUNCEMENT_IMAGE);
      // Served as the public image it now is: cached as public images are.
      expect(first.headers["cache-control"]).toBeUndefined();
      expect(ANNOUNCEMENT_IMAGE.isPublic).toBe(true);
      expect(shownAsks).toEqual([ANNOUNCEMENT_IMAGE.id]);

      // The next request is answered by the public read alone.
      reads = [];
      expectServed(
        await get({
          port,
          path: tokenPath(ANNOUNCEMENT_IMAGE),
          cookies: asSession(OUTSIDER_ID),
        }),
        ANNOUNCEMENT_IMAGE,
      );
      expect(reads).toHaveLength(1);
      expect(shownAsks).toEqual([ANNOUNCEMENT_IMAGE.id]);
    });

    it("by its id, is never served before then: only a public file is served by its id", async () => {
      announcementShownFrom = new Date(Date.now() + 60 * 60 * 1000);

      const result: HttpResult = await get({
        port,
        path: idPath(ANNOUNCEMENT_IMAGE),
      });

      expect(result.status).toBe(404);
      expect(shownAsks).toEqual([]);
    });

    it("no other private image is made public by the question", async () => {
      announcementShownFrom = new Date(Date.now() - 1000);

      await expectRefusedLikeMissing(
        await get({ port, path: tokenPath(PRIVATE_IMAGE) }),
        PRIVATE_IMAGE,
      );
      expect(shownAsks).toEqual([PRIVATE_IMAGE.id]);
      expect(PRIVATE_IMAGE.isPublic).toBe(false);
    });
  });

  it("answers a token that matches no file as a missing file", async () => {
    const result: HttpResult = await missingFileAnswer();

    expect(result.status).toBe(404);
    expect(result.body?.["message"] ?? result.body?.["error"]).toBe(
      "File not found",
    );
  });
});
