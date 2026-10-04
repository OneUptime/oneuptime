jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
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
import FormAPI, {
  FORM_FOREIGN_PAGE_MESSAGE,
} from "../../../Server/API/FormAPI";
import Redis from "../../../Server/Infrastructure/Redis";
import FileService from "../../../Server/Services/FileService";
import FormService, {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import SameOriginRequest from "../../../Server/Utils/SameOriginRequest";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import File from "../../../Models/DatabaseModels/File";
import Form from "../../../Models/DatabaseModels/Form";
import MimeType from "../../../Types/File/MimeType";
import { getDefaultFormFields } from "../../../Types/Form/FormField";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
} from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
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

// See FormPublicRoutes.test.ts: jsdom has no setImmediate, Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A form's logo and favicon over HTTP, as an anonymous visitor's browser
 * gets them: "A form's logo must be readable publicly only through that
 * form, never as a way to read any File by id."
 *
 * Driven through a real Express app with the real FormAPI router - the
 * read's own-page checks, the real limiter, the real user middleware and
 * the real FormService - and the real FileAPI router beside it, the one that
 * serves files by id. Only the data layer, the plan check and Redis are
 * stubbed.
 *
 * It pins:
 *   - the images travel inside the form's own read, base64, each form's
 *     own and no other's, after every check that read is behind - the
 *     page's header, other sites refused, the switch, the plan, the IP
 *     allowlist - and cost that read nothing extra;
 *   - nothing serves them at an address of their own, and the file route
 *     that serves files by id does not serve them: they stay private, and
 *     nothing in the form's answer names them;
 *   - only a file of the form's own project is ever handed over: not one of
 *     another project, nor one uploaded with none, even when a form's row
 *     names one (every write refuses that already - FormBranding.test.ts -
 *     and the read checks again).
 *
 * The plan check is stubbed (see FormPublicRoutes.test.ts), so the suite
 * holds with BILLING_ENABLED on, as CI runs it, and off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f99",
);

const ACME_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const GLOBEX_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae8";
const PLAIN_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae9";
const OFF_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90aea";
const LOCKED_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90aeb";
const FOREIGN_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90aec";

const ACME_LOGO_ID: string = "f1000000-0000-4000-8000-000000000001";
const ACME_FAVICON_ID: string = "f1000000-0000-4000-8000-000000000002";
const GLOBEX_LOGO_ID: string = "f1000000-0000-4000-8000-000000000003";
// A private file no form shows: an attachment of an internal note, say.
const PRIVATE_FILE_ID: string = "f1000000-0000-4000-8000-000000000004";
// Images of another project, and of none (uploaded before files had one).
const FOREIGN_FILE_ID: string = "f1000000-0000-4000-8000-000000000005";
const UNOWNED_FILE_ID: string = "f1000000-0000-4000-8000-000000000006";

const ALLOWED_IP: string = "198.51.100.23";
const OTHER_IP: string = "203.0.113.7";

const INSTANCE_ORIGIN: string = "https://oneuptime.example.com";
const FOREIGN_ORIGIN: string = "https://evil.example";

function image(
  id: string,
  fileType: string,
  text: string,
  // The project it was uploaded in; null for none.
  projectId: ObjectID | null = PROJECT_ID,
): File {
  const row: File = new File();
  row._id = id;
  row.name = `${id}.img`;
  row.fileType = fileType as MimeType;
  row.file = Buffer.from(text);
  row.isPublic = false;
  row.imageAccessToken = `token-${id}`;

  if (projectId) {
    row.projectId = projectId;
  }

  return row;
}

const FILES: Record<string, File> = {
  [ACME_LOGO_ID]: image(ACME_LOGO_ID, MimeType.png, "acme logo bytes"),
  [ACME_FAVICON_ID]: image(ACME_FAVICON_ID, MimeType.svg, "<svg>acme</svg>"),
  [GLOBEX_LOGO_ID]: image(GLOBEX_LOGO_ID, MimeType.png, "globex logo bytes"),
  [PRIVATE_FILE_ID]: image(PRIVATE_FILE_ID, MimeType.png, "private bytes"),
  [FOREIGN_FILE_ID]: image(
    FOREIGN_FILE_ID,
    MimeType.png,
    "another project's private bytes",
    OTHER_PROJECT_ID,
  ),
  [UNOWNED_FILE_ID]: image(
    UNOWNED_FILE_ID,
    MimeType.png,
    "bytes of a file with no project",
    null,
  ),
};

function base64Of(id: string): string {
  return FILES[id]!.file!.toString("base64");
}

function buildForm(data: {
  key: string;
  name: string;
  logoId?: string;
  logoAltText?: string;
  faviconId?: string;
  isEnabled?: boolean;
  ipWhitelist?: string;
}): Form {
  const form: Form = new Form();
  form._id = ObjectID.generate().toString();
  form.projectId = PROJECT_ID;
  form.name = data.name;
  form.isEnabled = data.isEnabled !== false;
  form.shareKey = new ObjectID(data.key);
  form.targetType = FormTargetType.Incident;
  form.fields = getDefaultFormFields(
    FormTargetType.Incident,
  ) as unknown as JSONArray;
  form.targetSettings = {};
  form.ipWhitelist = data.ipWhitelist || "";

  if (data.logoId) {
    form.logoFileId = new ObjectID(data.logoId);
    form.logoFile = FILES[data.logoId]!;
  }

  if (data.logoAltText) {
    form.logoAltText = data.logoAltText;
  }

  if (data.faviconId) {
    form.faviconFileId = new ObjectID(data.faviconId);
    form.faviconFile = FILES[data.faviconId]!;
  }

  return form;
}

const FORMS: Array<Form> = [
  buildForm({
    key: ACME_KEY,
    name: "Report a Problem to Acme",
    logoId: ACME_LOGO_ID,
    logoAltText: "Acme Inc.",
    faviconId: ACME_FAVICON_ID,
  }),
  buildForm({
    key: GLOBEX_KEY,
    name: "Report a Problem to Globex",
    logoId: GLOBEX_LOGO_ID,
  }),
  buildForm({ key: PLAIN_KEY, name: "Report a Problem" }),
  buildForm({
    key: OFF_KEY,
    name: "Turned Off",
    logoId: ACME_LOGO_ID,
    isEnabled: false,
  }),
  buildForm({
    key: LOCKED_KEY,
    name: "Office Only",
    logoId: ACME_LOGO_ID,
    ipWhitelist: "198.51.100.0/24",
  }),
  /*
   * A row naming another project's file as its logo and a file of no
   * project as its favicon: what no write lets through, as if something
   * had written it anyway.
   */
  buildForm({
    key: FOREIGN_KEY,
    name: "Borrowed Branding",
    logoId: FOREIGN_FILE_ID,
    logoAltText: "Someone Else",
    faviconId: UNOWNED_FILE_ID,
  }),
];

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

// A counting Redis, as FormPublicRoutes.test.ts has it.
class FakeRedisClient {
  public counters: Map<string, number> = new Map();

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }
}

class FakePipeline {
  private commands: Array<() => [Error | null, unknown]> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      const next: number = (this.client.counters.get(key) || 0) + 1;
      this.client.counters.set(key, next);
      return [null, next];
    });

    return this;
  }

  public expire(): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
    return this.commands.map((command: () => [Error | null, unknown]) => {
      return command();
    });
  }
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: string;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  path: string;
  clientIp?: string;
  headers?: http.OutgoingHttpHeaders | undefined;
  withoutPageHeader?: boolean | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "GET",
          headers: {
            tenantid: "",
            ...(data.withoutPageHeader
              ? {}
              : { [FORM_PAGE_HEADER]: FORM_PAGE_HEADER_VALUE }),
            "x-forwarded-for": data.clientIp || ALLOWED_IP,
            ...(data.headers || {}),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              raw,
              body,
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

function readPath(shareKey: string): string {
  return `/api/form/public/${shareKey}`;
}

// No form's image, nor the private file, anywhere in what was answered.
function expectNoImageIn(result: HttpResult): void {
  for (const id of Object.keys(FILES)) {
    expect({ id, leaked: result.raw.includes(base64Of(id)) }).toEqual({
      id,
      leaked: false,
    });
    expect(result.raw).not.toContain(FILES[id]!.file!.toString("utf8"));
  }
}

describe("a form's logo and favicon over HTTP", () => {
  let server: http.Server;
  let port: number;
  let client: FakeRedisClient;
  let fileFindOneById: MockedFn;
  let fileFindOneBy: MockedFn;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new FormAPI().getRouter());
    router.use(new FileAPI().getRouter());
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
    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    jest.spyOn(FormService, "findOneBy").mockImplementation((async (findBy: {
      query: { shareKey?: ObjectID };
      select: Record<string, unknown>;
    }): Promise<Form | null> => {
      const form: Form | undefined = FORMS.find((candidate: Form) => {
        return (
          candidate.shareKey?.toString() === findBy.query.shareKey?.toString()
        );
      });

      if (!form) {
        return null;
      }

      /*
       * As Postgres would: the branding only when the lookup selected it,
       * through the form's own relations.
       */
      const read: Form = new Form();
      Object.assign(read, form);

      if (!findBy.select["logoFile"]) {
        delete read.logoFile;
      }

      if (!findBy.select["faviconFile"]) {
        delete read.faviconFile;
      }

      return read;
    }) as never);

    jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true as never);

    jest
      .spyOn(SameOriginRequest, "getInstanceOrigin")
      .mockReturnValue(INSTANCE_ORIGIN);

    // The file routes read files by id or by access token, as root.
    fileFindOneById = jest
      .spyOn(FileService, "findOneById")
      .mockImplementation((async (findBy: {
        id: ObjectID;
      }): Promise<File | null> => {
        return FILES[findBy.id.toString()] || null;
      }) as never) as unknown as MockedFn;

    fileFindOneBy = jest
      .spyOn(FileService, "findOneBy")
      .mockImplementation((async (findBy: {
        query: { imageAccessToken?: string };
      }): Promise<File | null> => {
        return (
          Object.values(FILES).find((row: File) => {
            return row.imageAccessToken === findBy.query.imageAccessToken;
          }) || null
        );
      }) as never) as unknown as MockedFn;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("inside the form's own read", () => {
    it("hands over the form's logo, its alt text and its favicon, base64", async () => {
      const result: HttpResult = await send({ port, path: readPath(ACME_KEY) });

      expect(result.status).toBe(200);
      expect(result.body?.["logo"]).toEqual({
        type: "image/png",
        data: base64Of(ACME_LOGO_ID),
      });
      expect(result.body?.["logoAltText"]).toBe("Acme Inc.");
      expect(result.body?.["favicon"]).toEqual({
        type: "image/svg+xml",
        data: base64Of(ACME_FAVICON_ID),
      });
      // As uncached as the questions it comes with.
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
    });

    it("hands each form its own images and never another form's", async () => {
      const acme: HttpResult = await send({ port, path: readPath(ACME_KEY) });
      const globex: HttpResult = await send({
        port,
        path: readPath(GLOBEX_KEY),
      });
      const plain: HttpResult = await send({ port, path: readPath(PLAIN_KEY) });

      expect(acme.raw).not.toContain(base64Of(GLOBEX_LOGO_ID));
      expect(globex.body?.["logo"]).toEqual({
        type: "image/png",
        data: base64Of(GLOBEX_LOGO_ID),
      });
      expect(globex.body).not.toHaveProperty("favicon");
      expect(globex.body).not.toHaveProperty("logoAltText");
      expect(globex.raw).not.toContain(base64Of(ACME_LOGO_ID));
      expect(globex.raw).not.toContain(base64Of(ACME_FAVICON_ID));

      // A form without branding: what it always was.
      expect(plain.status).toBe(200);
      expect(Object.keys(plain.body || {}).sort()).toEqual(
        ["fields", "isCaptchaRequired", "name"].sort(),
      );
      expectNoImageIn(plain);
    });

    it("reads the images with the form, never a file by its id", async () => {
      await send({ port, path: readPath(ACME_KEY) });

      expect(fileFindOneById).not.toHaveBeenCalled();
      expect(fileFindOneBy).not.toHaveBeenCalled();
    });

    it("names no file: no id, no name, no access token, no address", async () => {
      const result: HttpResult = await send({ port, path: readPath(ACME_KEY) });

      for (const id of [ACME_LOGO_ID, ACME_FAVICON_ID]) {
        expect(result.raw).not.toContain(id);
        expect(result.raw).not.toContain(FILES[id]!.name!);
        expect(result.raw).not.toContain(FILES[id]!.imageAccessToken!);
      }

      expect(result.raw).not.toContain("/file/");
    });

    it("never a file of another project, or of none, even when a form's row names one", async () => {
      const result: HttpResult = await send({
        port,
        path: readPath(FOREIGN_KEY),
      });

      // The form itself is served, as one without branding.
      expect(result.status).toBe(200);
      expect(result.body?.["name"]).toBe("Borrowed Branding");
      expect(result.body).not.toHaveProperty("logo");
      expect(result.body).not.toHaveProperty("logoAltText");
      expect(result.body).not.toHaveProperty("favicon");
      expectNoImageIn(result);
    });

    it("costs the read nothing extra: one page load is one read", async () => {
      await send({ port, path: readPath(ACME_KEY) });

      // By form and address, and by address: once each.
      expect(Array.from(client.counters.values())).toEqual([1, 1]);
    });
  });

  describe("only after every check the read is behind", () => {
    it("not for a request without the form page's header: another site's <img> or link", async () => {
      const result: HttpResult = await send({
        port,
        path: readPath(ACME_KEY),
        withoutPageHeader: true,
      });

      expect(result.status).toBe(403);
      expect(result.body?.["message"]).toBe(FORM_FOREIGN_PAGE_MESSAGE);
      expectNoImageIn(result);
    });

    it("not for another website's page", async () => {
      const result: HttpResult = await send({
        port,
        path: readPath(ACME_KEY),
        headers: { origin: FOREIGN_ORIGIN, "sec-fetch-site": "cross-site" },
      });

      expect(result.status).toBe(403);
      expectNoImageIn(result);
    });

    it("not for a form that is turned off", async () => {
      const result: HttpResult = await send({ port, path: readPath(OFF_KEY) });

      expect(result.status).toBe(404);
      expect(result.body?.["error"] ?? result.body?.["message"]).toBe(
        FORM_NOT_AVAILABLE_MESSAGE,
      );
      expectNoImageIn(result);
    });

    it("not for a network the form does not allow, but for one it does", async () => {
      const refused: HttpResult = await send({
        port,
        path: readPath(LOCKED_KEY),
        clientIp: OTHER_IP,
      });

      expect(refused.status).toBe(403);
      expect(refused.body?.["error"] ?? refused.body?.["message"]).toBe(
        FORM_NETWORK_NOT_ALLOWED_MESSAGE,
      );
      expectNoImageIn(refused);

      const allowed: HttpResult = await send({
        port,
        path: readPath(LOCKED_KEY),
        clientIp: ALLOWED_IP,
      });

      expect(allowed.status).toBe(200);
      expect(allowed.body?.["logo"]).toEqual({
        type: "image/png",
        data: base64Of(ACME_LOGO_ID),
      });
    });

    it("not for a project whose plan does not include forms", async () => {
      (FormService.isProjectOnPlan as unknown as MockedFn).mockResolvedValue(
        false as never,
      );

      const result: HttpResult = await send({ port, path: readPath(ACME_KEY) });

      expect(result.status).toBe(404);
      expectNoImageIn(result);
    });

    it("not for a link no form holds, nor a file's id in its place", async () => {
      for (const key of [
        "0f8fad5b-d9cb-469f-a165-70867728950e",
        ACME_LOGO_ID,
        PRIVATE_FILE_ID,
      ]) {
        const result: HttpResult = await send({ port, path: readPath(key) });

        expect(result.status).toBe(404);
        expectNoImageIn(result);
      }
    });
  });

  describe("never at an address of their own, never by a file's id", () => {
    it.each([
      ["the logo", `/api/form/public/${ACME_KEY}/logo`],
      ["the favicon", `/api/form/public/${ACME_KEY}/favicon`],
      ["a logo named by id", `/api/form/public/${ACME_KEY}/${ACME_LOGO_ID}`],
    ])(
      "no route under the form's link serves %s",
      async (_label: string, path: string) => {
        const result: HttpResult = await send({ port, path });

        expect(result.status).toBe(404);
        expectNoImageIn(result);
      },
    );

    it("the route that serves public files by id does not serve a form's images: they stay private", async () => {
      for (const id of [ACME_LOGO_ID, ACME_FAVICON_ID, PRIVATE_FILE_ID]) {
        const result: HttpResult = await send({
          port,
          path: `/api/file/image/${id}`,
          withoutPageHeader: true,
        });

        expect({ id, status: result.status }).toEqual({ id, status: 404 });
        expectNoImageIn(result);
      }
    });
  });
});
