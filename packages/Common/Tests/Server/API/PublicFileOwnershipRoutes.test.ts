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

import DashboardAPI from "../../../Server/API/DashboardAPI";
import IncidentInternalNoteAPI from "../../../Server/API/IncidentInternalNoteAPI";
import StatusPageAPI, {
  keepOwnStatusPageImages,
} from "../../../Server/API/StatusPageAPI";
import UserAPI from "../../../Server/API/UserAPI";
import PublicDashboardRateLimit from "../../../Server/Middleware/PublicDashboardRateLimit";
import DashboardService from "../../../Server/Services/DashboardService";
import FileService from "../../../Server/Services/FileService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import UserService from "../../../Server/Services/UserService";
import { PublicDashboardAccess } from "../../../Server/Utils/Dashboard/PublicDashboardAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import Response from "../../../Server/Utils/Response";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import File from "../../../Models/DatabaseModels/File";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A real Express app: an error that walks the many routes registered after
 * the one that threw is deferred with setImmediate, which Common's jsdom
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
 * THE IMAGES A PAGE SERVES ARE ITS PROJECT'S OWN FILES.
 *
 * A status page's logo, favicon and cover image, a public dashboard's logo
 * and favicon, a note's attachments and a person's profile picture are
 * served to people outside the project - most of them to anyone. Writes
 * accept only a record's own files (FileOwnership, DatabaseService); these
 * routes check the owner again as they read, whatever wrote the row, and
 * answer a file of another project - or of none - exactly as they answer a
 * record with no file at all.
 *
 * Driven through a real Express app with the production error handler; only
 * the data layer is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// A status page or dashboard whose images are its own project's files.
const OWN_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
// One whose images are files of another project.
const FOREIGN_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);
// One whose images have no project (none the backfill could give them).
const UNOWNED_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000003",
);

const OWN_FILE_ID: string = "f0000000-0000-4000-8000-000000000001";
const FOREIGN_FILE_ID: string = "f0000000-0000-4000-8000-000000000002";

const OWN_BYTES: Buffer = Buffer.from("own-project-image");
const FOREIGN_BYTES: Buffer = Buffer.from("other-project-image");
const UNOWNED_BYTES: Buffer = Buffer.from("unowned-image");

const DEFAULT_FILE_MARKER: string = "default-image";

function image(
  bytes: Buffer,
  projectId: ObjectID | null,
  fileId: string = OWN_FILE_ID,
): File {
  const file: File = new File();
  file._id = fileId;
  file.file = bytes;
  file.fileType = MimeType.png;
  file.name = "image.png";

  if (projectId) {
    file.projectId = projectId;
  }

  return file;
}

function buildPage(
  id: ObjectID,
  bytes: Buffer,
  owner: ObjectID | null,
): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = id.toString();
  page.projectId = PROJECT_ID;
  page.name = `Page ${id.toString()}`;
  page.isPublicStatusPage = true;
  page.isArchived = false;
  page.logoFileId = new ObjectID(OWN_FILE_ID);
  page.coverImageFileId = new ObjectID(OWN_FILE_ID);
  page.faviconFileId = new ObjectID(OWN_FILE_ID);
  page.logoFile = image(bytes, owner);
  page.coverImageFile = image(bytes, owner);
  page.faviconFile = image(bytes, owner);
  return page;
}

function buildDashboard(
  id: ObjectID,
  bytes: Buffer,
  owner: ObjectID | null,
): Dashboard {
  const dashboard: Dashboard = new Dashboard();
  dashboard._id = id.toString();
  dashboard.projectId = PROJECT_ID;
  dashboard.name = `Dashboard ${id.toString()}`;
  dashboard.isPublicDashboard = true;
  dashboard.logoFile = image(bytes, owner);
  dashboard.faviconFile = image(bytes, owner);
  return dashboard;
}

// Fresh rows for every request: a route may change what it is handed.
function pageOf(id: string): StatusPage | null {
  switch (id) {
    case OWN_PAGE_ID.toString():
      return buildPage(OWN_PAGE_ID, OWN_BYTES, PROJECT_ID);
    case FOREIGN_PAGE_ID.toString():
      return buildPage(FOREIGN_PAGE_ID, FOREIGN_BYTES, OTHER_PROJECT_ID);
    case UNOWNED_PAGE_ID.toString():
      return buildPage(UNOWNED_PAGE_ID, UNOWNED_BYTES, null);
    default:
      return null;
  }
}

function dashboardOf(id: string): Dashboard | null {
  switch (id) {
    case OWN_PAGE_ID.toString():
      return buildDashboard(OWN_PAGE_ID, OWN_BYTES, PROJECT_ID);
    case FOREIGN_PAGE_ID.toString():
      return buildDashboard(FOREIGN_PAGE_ID, FOREIGN_BYTES, OTHER_PROJECT_ID);
    case UNOWNED_PAGE_ID.toString():
      return buildDashboard(UNOWNED_PAGE_ID, UNOWNED_BYTES, null);
    default:
      return null;
  }
}

type HttpResult = { status: number; text: string; body: JSONObject | null };

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.method === "POST" ? "{}" : "";
      const headers: http.OutgoingHttpHeaders = { tenantid: "" };

      if (data.method === "POST") {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
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

            resolve({ status: response.statusCode || 0, text, body });
          });
        },
      );

      request.on("error", reject);

      if (payload) {
        request.write(payload);
      }

      request.end();
    },
  );
}

function base64(bytes: Buffer): string {
  return bytes.toString("base64");
}

// A file's bytes as the master page carries them (a serialized Buffer).
function serializedBytes(bytes: Buffer): string {
  return `"data":${JSON.stringify(Array.from(bytes))}`;
}

describe("public routes serve only a record's own files", () => {
  let server: http.Server;
  let port: number;
  let selects: Array<Dictionary<unknown>> = [];

  beforeAll(async () => {
    jest
      .spyOn(PublicDashboardRateLimit, "getMiddleware")
      .mockReturnValue(
        async (
          _req: ExpressRequest,
          _res: ExpressResponse,
          next: NextFunction,
        ): Promise<void> => {
          next();
        },
      );

    /*
     * A member route reads the project's plan when billing is on (CI runs
     * with it on), and notes the project's activity.
     */
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    } as never);
    jest
      .spyOn(ProjectService, "updateLastActive")
      .mockResolvedValue(undefined as never);

    // Where a route falls back to a default image, it says so plainly.
    jest
      .spyOn(Response, "sendFileByPath")
      .mockImplementation(
        (_req: ExpressRequest, res: ExpressResponse): void => {
          res.status(200).send(DEFAULT_FILE_MARKER);
        },
      );

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation((async (data: {
        query: Dictionary<unknown>;
        select: Dictionary<unknown>;
      }) => {
        selects.push(data.select);
        return pageOf(String(data.query["_id"]));
      }) as never);

    jest
      .spyOn(StatusPageService, "findOneById")
      .mockImplementation((async (data: {
        id: ObjectID;
        select: Dictionary<unknown>;
      }) => {
        selects.push(data.select);
        return pageOf(data.id.toString());
      }) as never);

    jest
      .spyOn(StatusPageSsoService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockResolvedValue(null as never);

    jest.spyOn(DashboardService, "getPublicAccess").mockResolvedValue({
      access: PublicDashboardAccess.Granted,
      isMasterPasswordRequired: false,
    } as never);
    jest
      .spyOn(DashboardService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true } as never);
    jest
      .spyOn(DashboardService, "findOneById")
      .mockImplementation((async (data: {
        id: ObjectID;
        select: Dictionary<unknown>;
      }) => {
        selects.push(data.select);
        return dashboardOf(data.id.toString());
      }) as never);

    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    app.use("/api", new DashboardAPI().getRouter());
    app.use("/api", new StatusPageAPI().getRouter());
    app.use("/api", new UserAPI().getRouter());
    app.use("/api", new IncidentInternalNoteAPI().getRouter());
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    selects = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });

    jest.restoreAllMocks();
  });

  describe("a status page's logo, cover image and favicon", () => {
    it("serves the images of the page's own project", async () => {
      for (const asset of ["logo", "cover-image", "favicon"]) {
        const result: HttpResult = await send({
          port,
          method: "GET",
          path: `/api/status-page/${asset}/${OWN_PAGE_ID.toString()}`,
        });

        expect({ asset, status: result.status, text: result.text }).toEqual({
          asset,
          status: 200,
          text: OWN_BYTES.toString("utf8"),
        });
      }
    });

    it("reads each image with its project, to hold it to the page's", async () => {
      await send({
        port,
        method: "GET",
        path: `/api/status-page/logo/${OWN_PAGE_ID.toString()}`,
      });

      expect(selects[0]).toMatchObject({
        projectId: true,
        logoFile: { file: true, projectId: true },
      });
    });

    it("serves no logo or cover image of another project, or of none, as if there were none", async () => {
      for (const pageId of [FOREIGN_PAGE_ID, UNOWNED_PAGE_ID]) {
        for (const [asset, message] of [
          ["logo", "Status Page logo not found"],
          ["cover-image", "Status Page cover image not found"],
        ]) {
          const result: HttpResult = await send({
            port,
            method: "GET",
            path: `/api/status-page/${asset}/${pageId.toString()}`,
          });

          expect({ asset, status: result.status }).toEqual({
            asset,
            status: 404,
          });
          expect(result.body?.["message"] ?? result.body?.["error"]).toBe(
            message,
          );
          expect(result.text).not.toContain(FOREIGN_BYTES.toString("utf8"));
          expect(result.text).not.toContain(UNOWNED_BYTES.toString("utf8"));
        }
      }
    });

    it("shows the default favicon in place of another project's", async () => {
      for (const pageId of [FOREIGN_PAGE_ID, UNOWNED_PAGE_ID]) {
        const result: HttpResult = await send({
          port,
          method: "GET",
          path: `/api/status-page/favicon/${pageId.toString()}`,
        });

        expect(result.status).toBe(200);
        expect(result.text).toBe(DEFAULT_FILE_MARKER);
      }
    });
  });

  describe("the master page the status page app loads first", () => {
    it("carries the page's own images, and no project id", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/status-page/master-page/${OWN_PAGE_ID.toString()}`,
      });

      expect(result.status).toBe(200);

      const statusPage: JSONObject = result.body?.["statusPage"] as JSONObject;

      for (const relation of ["logoFile", "coverImageFile", "faviconFile"]) {
        expect(statusPage[relation]).toBeDefined();
        expect(
          (statusPage[relation] as JSONObject)["projectId"],
        ).toBeUndefined();
      }

      expect(statusPage["logoFileId"]).toBeDefined();
      expect(statusPage["coverImageFileId"]).toBeDefined();
      expect(statusPage["projectId"]).toBeUndefined();
      expect(result.text).toContain(serializedBytes(OWN_BYTES));
    });

    it("leaves out images of another project, or of none, ids and all", async () => {
      for (const pageId of [FOREIGN_PAGE_ID, UNOWNED_PAGE_ID]) {
        const result: HttpResult = await send({
          port,
          method: "POST",
          path: `/api/status-page/master-page/${pageId.toString()}`,
        });

        expect(result.status).toBe(200);

        const statusPage: JSONObject = result.body?.[
          "statusPage"
        ] as JSONObject;

        for (const column of [
          "logoFile",
          "logoFileId",
          "coverImageFile",
          "coverImageFileId",
          "faviconFile",
          "faviconFileId",
          "projectId",
        ]) {
          expect({ column, value: statusPage[column] }).toEqual({
            column,
            value: undefined,
          });
        }

        expect(result.text).not.toContain(serializedBytes(FOREIGN_BYTES));
        expect(result.text).not.toContain(serializedBytes(UNOWNED_BYTES));
      }
    });
  });

  describe("keepOwnStatusPageImages", () => {
    it("keeps a mix: the own logo stays, another project's cover image goes", () => {
      const page: StatusPage = buildPage(OWN_PAGE_ID, OWN_BYTES, PROJECT_ID);
      page.coverImageFile = image(FOREIGN_BYTES, OTHER_PROJECT_ID);

      keepOwnStatusPageImages(page);

      expect(page.logoFile?.file).toBe(OWN_BYTES);
      expect(page.logoFile?.projectId).toBeUndefined();
      expect(page.logoFileId?.toString()).toBe(OWN_FILE_ID);
      expect(page.coverImageFile).toBeUndefined();
      expect(page.coverImageFileId).toBeUndefined();
      expect(page.projectId).toBeUndefined();
    });
  });

  describe("a public dashboard's logo and favicon", () => {
    it("carries the dashboard's own images", async () => {
      const metadata: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/dashboard/metadata/${OWN_PAGE_ID.toString()}`,
      });

      expect(metadata.status).toBe(200);
      expect((metadata.body?.["logoFile"] as JSONObject | null)?.["file"]).toBe(
        base64(OWN_BYTES),
      );
      expect(
        (metadata.body?.["faviconFile"] as JSONObject | null)?.["file"],
      ).toBe(base64(OWN_BYTES));
      expect(metadata.body?.["projectId"]).toBeUndefined();

      const viewConfig: HttpResult = await send({
        port,
        method: "POST",
        path: `/api/dashboard/view-config/${OWN_PAGE_ID.toString()}`,
      });

      expect(viewConfig.status).toBe(200);
      expect(
        (viewConfig.body?.["logoFile"] as JSONObject | null)?.["file"],
      ).toBe(base64(OWN_BYTES));
    });

    it("reads each image with its project, to hold it to the dashboard's", async () => {
      await send({
        port,
        method: "POST",
        path: `/api/dashboard/metadata/${OWN_PAGE_ID.toString()}`,
      });

      expect(selects[0]).toMatchObject({
        projectId: true,
        logoFile: { file: true, projectId: true },
        faviconFile: { file: true, projectId: true },
      });
    });

    it("leaves out images of another project, or of none", async () => {
      for (const dashboardId of [FOREIGN_PAGE_ID, UNOWNED_PAGE_ID]) {
        for (const route of ["metadata", "view-config"]) {
          const result: HttpResult = await send({
            port,
            method: "POST",
            path: `/api/dashboard/${route}/${dashboardId.toString()}`,
          });

          expect({ route, status: result.status }).toEqual({
            route,
            status: 200,
          });
          expect({ route, logoFile: result.body?.["logoFile"] }).toEqual({
            route,
            logoFile: null,
          });
          expect(result.text).not.toContain(base64(FOREIGN_BYTES));
          expect(result.text).not.toContain(base64(UNOWNED_BYTES));
        }

        const metadata: HttpResult = await send({
          port,
          method: "POST",
          path: `/api/dashboard/metadata/${dashboardId.toString()}`,
        });

        expect(metadata.body?.["faviconFile"]).toBeNull();
      }
    });
  });

  describe("a person's profile picture", () => {
    function withPicture(createdByUserId: ObjectID | null): void {
      jest.spyOn(UserService, "findOneBy").mockImplementation((async (data: {
        select: Dictionary<unknown>;
      }) => {
        selects.push(data.select);

        const user: User = new User();
        user._id = USER_ID.toString();

        const picture: File = image(OWN_BYTES, null);

        if (createdByUserId) {
          picture.createdByUserId = createdByUserId;
        }

        user.profilePictureFile = picture;
        return user;
      }) as never);
    }

    it("serves a picture the person uploaded", async () => {
      withPicture(USER_ID);

      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/user/profile-picture/${USER_ID.toString()}`,
      });

      expect(result.status).toBe(200);
      expect(result.text).toBe(OWN_BYTES.toString("utf8"));
      expect(selects[0]).toMatchObject({
        profilePictureFile: { file: true, createdByUserId: true },
      });
    });

    it("serves the blank picture in place of a file someone else uploaded, or nobody", async () => {
      for (const uploader of [OTHER_USER_ID, null]) {
        withPicture(uploader);

        const result: HttpResult = await send({
          port,
          method: "GET",
          path: `/api/user/profile-picture/${USER_ID.toString()}`,
        });

        expect(result.status).toBe(200);
        expect(result.text).toBe(DEFAULT_FILE_MARKER);
      }
    });
  });

  describe("a note's attachment, for the project's members", () => {
    beforeEach(() => {
      jest
        .spyOn(IncidentInternalNoteService, "findOneBy")
        .mockImplementation((async (data: { select: Dictionary<unknown> }) => {
          selects.push(data.select);

          const note: IncidentInternalNote = new IncidentInternalNote();
          note._id = "eeeeeeee-0000-4000-8000-000000000001";
          note.projectId = PROJECT_ID;
          note.attachments = [
            image(OWN_BYTES, null, OWN_FILE_ID),
            image(FOREIGN_BYTES, null, FOREIGN_FILE_ID),
          ];
          return note;
        }) as never);

      const owners: Map<string, FileOwners> = new Map([
        [OWN_FILE_ID, { projectId: PROJECT_ID, createdByUserId: USER_ID }],
        [
          FOREIGN_FILE_ID,
          { projectId: OTHER_PROJECT_ID, createdByUserId: OTHER_USER_ID },
        ],
      ]);

      jest
        .spyOn(FileService, "getFileOwners")
        .mockResolvedValue(owners as never);
    });

    it("serves an attachment uploaded in the note's project", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/incident-internal-note/attachment/${PROJECT_ID.toString()}/eeeeeeee-0000-4000-8000-000000000001/${OWN_FILE_ID}`,
      });

      expect(result.status).toBe(200);
      expect(result.text).toBe(OWN_BYTES.toString("utf8"));
      expect(selects[0]).toMatchObject({ projectId: true });
    });

    it("answers an attachment of another project as one that is not there", async () => {
      const foreign: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/incident-internal-note/attachment/${PROJECT_ID.toString()}/eeeeeeee-0000-4000-8000-000000000001/${FOREIGN_FILE_ID}`,
      });
      const missing: HttpResult = await send({
        port,
        method: "GET",
        path: `/api/incident-internal-note/attachment/${PROJECT_ID.toString()}/eeeeeeee-0000-4000-8000-000000000001/f0000000-0000-4000-8000-0000000000ff`,
      });

      expect(foreign.status).toBe(404);
      expect(foreign.status).toBe(missing.status);
      expect(foreign.body).toEqual(missing.body);
      expect(foreign.text).not.toContain(FOREIGN_BYTES.toString("utf8"));
    });
  });
});
