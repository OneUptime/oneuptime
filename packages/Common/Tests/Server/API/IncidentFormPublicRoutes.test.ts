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

import IncidentFormAPI, {
  INCIDENT_FORM_FOREIGN_PAGE_MESSAGE,
  INCIDENT_FORM_SUBMISSION_BODY_MESSAGE,
} from "../../../Server/API/IncidentFormAPI";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import Redis from "../../../Server/Infrastructure/Redis";
import {
  INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
} from "../../../Server/Middleware/IncidentFormRateLimit";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFormService, {
  INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/IncidentFormService";
import IncidentFormSubmissionService from "../../../Server/Services/IncidentFormSubmissionService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRouter } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import SameOriginRequest from "../../../Server/Utils/SameOriginRequest";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import {
  INCIDENT_FORM_PAGE_HEADER,
  INCIDENT_FORM_PAGE_HEADER_VALUE,
  IncidentFormFieldSetting,
} from "../../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
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
import jwt from "jsonwebtoken";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A handler's refusal travels as next(err), and Express leaves a router
 * whose layers are exhausted with setImmediate(done, err). Common's jest
 * environment is jsdom, which has no setImmediate - without this every
 * refusal would hang the request instead of reaching the error handler. Lend
 * jsdom Node's own, as MultipartFormData.test.ts does.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * The public incident form routes, driven through a real Express app with
 * cookie-parser, the JSON body parser and the production error handler -
 * the real IncidentFormAPI router, the real limiter, the real user
 * middleware and the real IncidentFormService. Only the data layer (and the
 * captcha provider and Redis) are stubbed.
 *
 * It pins what the public form page has to handle - the status codes and
 * the messages - and the one property the page depends on most: a visitor's
 * own OneUptime session cookie, which rides along because the page is served
 * on the dashboard's host, never turns into a 401. A 401 would send the
 * dashboard client to the login page (losing the report being typed), or
 * sign the visitor out of their real session. A cookie that no longer
 * decodes, an expired one and a junk one are all simply ignored, and a
 * valid one is ignored too: forms are anonymous.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: string = "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f02";
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OFF_SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae8";
const LOCKED_SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae9";
const UNKNOWN_SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const INCIDENT_ID: string = "e0000000-0000-4000-8000-0000000000f1";
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// The client address our proxy would append, and one outside the allowlist.
const ALLOWED_IP: string = "198.51.100.23";
const OTHER_IP: string = "203.0.113.7";

// This instance, as HTTP_PROTOCOL and HOST configure it, and another site.
const INSTANCE_ORIGIN: string = "https://oneuptime.example.com";
const FOREIGN_ORIGIN: string = "https://evil.example";

const INVALID_ACCESS_TOKEN_MESSAGE: string =
  "AccessToken is invalid or expired. Please refresh your token.";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

/*
 * A counting Redis fake. `countFloor` makes every counter read at least
 * that much, which is how a test puts a caller over a limit without firing
 * hundreds of requests first.
 */
class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public countFloor: number = 0;

  // A pipeline counting a key this matches fails, as a broken Redis would.
  public failKeysMatching: RegExp | null = null;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public keysMatching(fragment: string): Array<string> {
    return Array.from(this.counters.keys()).filter((key: string) => {
      return key.includes(fragment);
    });
  }
}

type QueuedCommand = () => [Error | null, unknown];

class FakePipeline {
  private commands: Array<QueuedCommand> = [];
  private keys: Array<string> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.keys.push(key);
    this.commands.push((): [Error | null, unknown] => {
      const next: number = Math.max(
        (this.client.counters.get(key) || 0) + 1,
        this.client.countFloor,
      );
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
    const failKeysMatching: RegExp | null = this.client.failKeysMatching;

    if (
      failKeysMatching &&
      this.keys.some((key: string): boolean => {
        return failKeysMatching.test(key);
      })
    ) {
      throw new Error("connection reset");
    }

    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

function buildForm(data: {
  shareKey: string;
  isEnabled?: boolean;
  ipWhitelist?: string;
}): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.description = "Tell us what is broken.";
  form.isEnabled = data.isEnabled !== false;
  form.shareKey = new ObjectID(data.shareKey);
  form.incidentSeverityId = new ObjectID(SEVERITY_ID);
  form.allowReporterToChooseSeverity = false;
  form.descriptionSetting = IncidentFormFieldSetting.Optional;
  form.customFieldSettings = {};
  form.isReporterDetailsRequired = true;
  form.successMessage = "Thanks - we are on it.";
  form.ipWhitelist = data.ipWhitelist || "";
  return form;
}

const FORMS: Array<IncidentForm> = [
  buildForm({ shareKey: SHARE_KEY }),
  buildForm({ shareKey: OFF_SHARE_KEY, isEnabled: false }),
  buildForm({ shareKey: LOCKED_SHARE_KEY, ipWhitelist: "198.51.100.0/24" }),
];

const PUBLIC_FORM: JSONObject = {
  name: "Report a Problem",
  description: "Tell us what is broken.",
  descriptionSetting: "Optional",
  isReporterDetailsRequired: true,
  customFields: [],
  isCaptchaRequired: false,
};

const ANSWERS: JSONObject = {
  title: "Checkout is down",
  description: "Every order fails.",
  reporterName: "Jane Doe",
  reporterEmail: "jane@example.com",
};

const SUBMISSION_RESULT: JSONObject = {
  incidentNumber: "INC-42",
  successMessage: "Thanks - we are on it.",
};

// Signed with a secret this instance no longer uses: a rotation happened.
const STALE_ACCESS_TOKEN: string = jwt.sign(
  {
    userId: USER_ID.toString(),
    email: "viewer@example.com",
    name: "Viewer",
    isMasterAdmin: false,
    isGlobalLogin: true,
    sessionId: "44444444-4444-4444-8444-444444444444",
  },
  `${EncryptionSecret.toString()}-before-rotation`,
  { expiresIn: 15 * 60 },
);

// Signed with the right secret, but past its lifetime.
const EXPIRED_ACCESS_TOKEN: string = jwt.sign(
  {
    userId: USER_ID.toString(),
    email: "viewer@example.com",
    name: "Viewer",
    isMasterAdmin: false,
    isGlobalLogin: true,
    sessionId: "44444444-4444-4444-8444-444444444444",
    exp: Math.floor(Date.now() / 1000) - 60,
  },
  EncryptionSecret.toString(),
);

function validAccessToken(): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("viewer@example.com"),
      name: new Name("Viewer"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  clientIp?: string;
  cookies?: Dictionary<string> | undefined;
  headers?: http.OutgoingHttpHeaders | undefined;
  /*
   * Without the header the form page's API client adds to every request:
   * what an <img>, a link, a frame or a no-cors fetch sends.
   */
  withoutPageHeader?: boolean | undefined;
  body?: unknown;
  // Sent as it is, with the content-type the headers give: not JSON.
  rawBody?: string | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" && data.body !== undefined
          ? JSON.stringify(data.body)
          : "";

      const headers: http.OutgoingHttpHeaders = {
        // What the public form page's API client sends.
        tenantid: "",
        ...(data.withoutPageHeader
          ? {}
          : { [INCIDENT_FORM_PAGE_HEADER]: INCIDENT_FORM_PAGE_HEADER_VALUE }),
        // What our proxy appends: the client address, the trusted hop.
        "x-forwarded-for": data.clientIp || ALLOWED_IP,
        ...(data.headers || {}),
      };

      const cookieHeader: string = Object.entries(data.cookies || {})
        .map(([name, value]: [string, string]) => {
          return `${name}=${value}`;
        })
        .join("; ");

      if (cookieHeader) {
        headers["cookie"] = cookieHeader;
      }

      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }

      if (data.rawBody !== undefined) {
        headers["content-length"] = Buffer.byteLength(data.rawBody);
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
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = { raw };
            }

            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body,
            });
          });
        },
      );

      request.on("error", reject);

      if (payload) {
        request.write(payload);
      }

      if (data.rawBody !== undefined) {
        request.write(data.rawBody);
      }

      request.end();
    },
  );
}

/*
 * A limiter refusal is written by Response.sendErrorResponse ({ message });
 * a handler's refusal goes through the production error handler ({ error }).
 * The page's API client reads either.
 */
function errorMessageOf(result: HttpResult): unknown {
  return result.body?.["message"] ?? result.body?.["error"];
}

// Only what the page would see: the status and the body.
function seen(result: HttpResult): { status: number; body: unknown } {
  return { status: result.status, body: result.body };
}

describe("the public incident form routes over HTTP", () => {
  let server: http.Server;
  let port: number;
  let client: FakeRedisClient;
  let incidentCreate: MockedFn;
  let getPublicForm: MockedFn;
  let submitPublicForm: MockedFn;
  let onPlan: MockedFn;

  const readPath: (shareKey: string) => string = (shareKey: string) => {
    return `/api/incident-form/public/${shareKey}`;
  };

  const submitPath: (shareKey: string) => string = (shareKey: string) => {
    return `/api/incident-form/public/${shareKey}/submit`;
  };

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    /*
     * As StartServer mounts it: "data[title]=..." from a plain HTML form
     * becomes the very object a JSON body gives.
     */
    app.use(express.urlencoded({ extended: true }));
    app.use("/api", new IncidentFormAPI().getRouter());
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

    jest
      .spyOn(IncidentFormService, "findOneBy")
      .mockImplementation((async (findBy: {
        query: { shareKey?: ObjectID };
      }): Promise<IncidentForm | null> => {
        return (
          FORMS.find((form: IncidentForm) => {
            return (
              form.shareKey?.toString() === findBy.query.shareKey?.toString()
            );
          }) || null
        );
      }) as never);

    jest.spyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([]);

    /*
     * The plan check reads the project's subscription, which this suite has
     * no database for. Left real, it would pass only where billing is off:
     * CI's Common job runs with BILLING_ENABLED=true, the read fails, the
     * check fails closed, and every form here would answer "not available".
     * The check itself is pinned in IncidentFormPublicForm.test.ts; the
     * off-plan test below turns it the other way.
     */
    onPlan = jest
      .spyOn(IncidentFormService, "isProjectOnPlan")
      .mockResolvedValue(true as never) as unknown as MockedFn;

    // HOST is not configured in a unit run; the instance says it is this.
    jest
      .spyOn(SameOriginRequest, "getInstanceOrigin")
      .mockReturnValue(INSTANCE_ORIGIN);

    incidentCreate = jest
      .spyOn(IncidentService, "create")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID;
        incident.projectId = PROJECT_ID;
        incident.incidentNumber = 42;
        incident.incidentNumberWithPrefix = "INC-42";
        return incident;
      }) as never) as unknown as MockedFn;

    jest
      .spyOn(IncidentFormSubmissionService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);
    jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);

    jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);

    /*
     * What a signed-in visitor's valid session touches in the user
     * middleware. Nothing here reads the database.
     */
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    jest.spyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    jest.spyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);

    getPublicForm = jest.spyOn(
      IncidentFormService,
      "getPublicForm",
    ) as unknown as MockedFn;
    submitPublicForm = jest.spyOn(
      IncidentFormService,
      "submitPublicForm",
    ) as unknown as MockedFn;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("200", () => {
    it("serves the form's questions, uncached", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
      });

      expect(seen(result)).toEqual({ status: 200, body: PUBLIC_FORM });
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
      expect(result.headers["pragma"]).toBe("no-cache");

      // The plan gate stays on the path; only its database read is stubbed.
      expect(onPlan).toHaveBeenCalledTimes(1);
      expect(String(onPlan.mock.calls[0]![0])).toBe(PROJECT_ID.toString());
    });

    it("declares the incident and answers with its number and the success message", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: ANSWERS },
      });

      expect(seen(result)).toEqual({ status: 200, body: SUBMISSION_RESULT });
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
      expect(incidentCreate).toHaveBeenCalledTimes(1);
    });

    /*
     * The tenant the user middleware reads from a header or the body is
     * never where the incident goes: that is always the form's project.
     */
    it("declares in the form's project whatever tenant the request names", async () => {
      await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        headers: { tenantid: OTHER_PROJECT_ID },
        body: { data: ANSWERS, projectId: OTHER_PROJECT_ID },
      });

      const created: Incident = (
        incidentCreate.mock.calls[0]![0] as { data: Incident }
      ).data;

      expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    });

    it("takes the share key in any case", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY.toUpperCase()),
      });

      expect(result.status).toBe(200);
    });
  });

  describe("400", () => {
    it("names every problem with the answers, and declares nothing", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: { title: " ", reporterEmail: "jane" } },
      });

      expect(result.status).toBe(400);
      expect(errorMessageOf(result)).toBe(
        "Title is required. Your Name is required. Your Email is not a valid email address.",
      );
      expect(incidentCreate).not.toHaveBeenCalled();
    });

    it.each([
      ["no body", undefined],
      ["a body without answers", { title: "Down" }],
      ["answers that are not an object", { data: "Down" }],
    ])("refuses %s", async (_label: string, body: unknown) => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body,
      });

      expect(result.status).toBe(400);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_SUBMISSION_BODY_MESSAGE,
      );
      expect(submitPublicForm).not.toHaveBeenCalled();
    });

    /*
     * The provider round trip is the one thing stubbed here: its refusal is
     * a BadDataException, exactly as CaptchaUtil throws it.
     */
    it("refuses a submission the captcha provider rejects, when the instance has a captcha on", async () => {
      jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(true);
      const verifyCaptcha: MockedFn = jest
        .spyOn(CaptchaUtil, "verifyCaptcha")
        .mockRejectedValue(
          new BadDataException(
            "Captcha verification failed. Please try again.",
          ),
        ) as unknown as MockedFn;

      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: ANSWERS, captchaToken: "solved-token" },
      });

      expect(result.status).toBe(400);
      expect(errorMessageOf(result)).toBe(
        "Captcha verification failed. Please try again.",
      );
      expect(verifyCaptcha).toHaveBeenCalledWith({
        token: "solved-token",
        remoteIp: ALLOWED_IP,
      });
      expect(incidentCreate).not.toHaveBeenCalled();
    });

    it("declares once the captcha provider accepts the token", async () => {
      jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(true);
      jest.spyOn(CaptchaUtil, "verifyCaptcha").mockResolvedValue(undefined);

      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: ANSWERS, captchaToken: "solved-token" },
      });

      expect(seen(result)).toEqual({ status: 200, body: SUBMISSION_RESULT });
    });
  });

  describe("403", () => {
    it("refuses to show a form to a network it does not allow", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(LOCKED_SHARE_KEY),
        clientIp: OTHER_IP,
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
      );
    });

    it("refuses a submission from a network it does not allow", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(LOCKED_SHARE_KEY),
        clientIp: OTHER_IP,
        body: { data: ANSWERS },
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
      );
      expect(incidentCreate).not.toHaveBeenCalled();
    });

    /*
     * The address checked is the one our proxy appended, not one the caller
     * wrote into X-Forwarded-For themselves.
     */
    it("cannot be talked round by a forged X-Forwarded-For entry", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(LOCKED_SHARE_KEY),
        clientIp: `${ALLOWED_IP}, ${OTHER_IP}`,
      });

      expect(result.status).toBe(403);
    });

    it("serves an allowed network", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(LOCKED_SHARE_KEY),
        clientIp: ALLOWED_IP,
      });

      expect(result.status).toBe(200);
    });
  });

  /*
   * Any website can have a visitor's browser send these requests - the API
   * answers every origin, and a plain HTML form or an <img> needs no
   * preflight - from the visitor's own address: inside the form's IP
   * allowlist, and on the budget everybody behind that address shares. Such
   * a request is refused before anything counts it or looks the link up.
   * The form's own page is served, and so is a caller that is not a browser
   * but sends what the page sends; a read must carry the page's header and
   * a submission's body must be JSON, whoever sends them.
   */
  describe("a request another site's page had a browser send", () => {
    // What a plain HTML form on another site posts.
    const FORGED_FORM: string =
      "data%5Btitle%5D=Forged+outage&data%5BreporterName%5D=CEO&data%5BreporterEmail%5D=ceo%40corp.example";

    const OWN_PAGE: http.OutgoingHttpHeaders = {
      origin: INSTANCE_ORIGIN,
      "sec-fetch-site": "same-origin",
    };

    it("refuses a plain HTML form another site auto-posts from inside the allowlist, before anything counts it", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(LOCKED_SHARE_KEY),
        clientIp: ALLOWED_IP,
        headers: {
          origin: FOREIGN_ORIGIN,
          "sec-fetch-site": "cross-site",
          "content-type": "application/x-www-form-urlencoded",
        },
        rawBody: FORGED_FORM,
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE);
      expect(submitPublicForm).not.toHaveBeenCalled();
      expect(incidentCreate).not.toHaveBeenCalled();
      expect(client.counters.size).toBe(0);
    });

    // A preflighted JSON request carries the same Origin.
    it("refuses the same request sent as JSON: the body's type is not what stops it", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(LOCKED_SHARE_KEY),
        clientIp: ALLOWED_IP,
        headers: { origin: FOREIGN_ORIGIN, "sec-fetch-site": "cross-site" },
        body: { data: ANSWERS },
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE);
      expect(incidentCreate).not.toHaveBeenCalled();
      expect(client.counters.size).toBe(0);
    });

    it.each([
      ["a cross-site read", { "sec-fetch-site": "cross-site" }],
      ["a read from another site's page", { origin: FOREIGN_ORIGIN }],
      ["a read from an opaque origin (a sandboxed frame)", { origin: "null" }],
      /*
       * A status page on its owner's domain, or a DNS-rebinding name pointed
       * at this server: the browser calls it same-origin, but it is not
       * this instance's page.
       */
      [
        "a read from another host the browser calls same-origin",
        {
          origin: "https://status.customer.example",
          "sec-fetch-site": "same-origin",
        },
      ],
    ])(
      "refuses %s, before anything counts it",
      async (_label: string, headers: http.OutgoingHttpHeaders) => {
        const result: HttpResult = await send({
          port,
          method: "GET",
          path: readPath(SHARE_KEY),
          headers: headers,
        });

        expect(result.status).toBe(403);
        expect(errorMessageOf(result)).toBe(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE);
        expect(getPublicForm).not.toHaveBeenCalled();
        expect(client.counters.size).toBe(0);
      },
    );

    /*
     * Thirty-one posts to a made-up link from another site's page, through
     * one visitor's browser: counted, they would have used up the 30 per 15
     * minutes everybody behind that address shares across every form.
     */
    it("cannot use up the budget of the address it sends from", async () => {
      for (let attempt: number = 0; attempt < 31; attempt++) {
        const refused: HttpResult = await send({
          port,
          method: "POST",
          path: submitPath(ObjectID.generate().toString()),
          clientIp: ALLOWED_IP,
          headers: { origin: FOREIGN_ORIGIN, "sec-fetch-site": "cross-site" },
          body: { data: ANSWERS },
        });

        expect(refused.status).toBe(403);
      }

      const colleague: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        clientIp: ALLOWED_IP,
        headers: OWN_PAGE,
        body: { data: ANSWERS },
      });

      expect(seen(colleague)).toEqual({
        status: 200,
        body: SUBMISSION_RESULT,
      });

      /*
       * Only the colleague's own report was counted: once by address, once
       * by form and address, and once against the form's ceiling.
       */
      expect(
        client
          .keysMatching(`:submit:i:${ALLOWED_IP}:`)
          .map((key: string): number => {
            return client.counters.get(key)!;
          }),
      ).toEqual([1]);
      expect(Array.from(client.counters.values())).toEqual([1, 1, 1]);
    });

    it("serves the form's own page: its read and its report", async () => {
      const read: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
        headers: OWN_PAGE,
      });

      expect(seen(read)).toEqual({ status: 200, body: PUBLIC_FORM });

      const report: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        headers: OWN_PAGE,
        body: { data: ANSWERS },
      });

      expect(seen(report)).toEqual({ status: 200, body: SUBMISSION_RESULT });
      expect(incidentCreate).toHaveBeenCalledTimes(1);
    });

    /*
     * Over plain HTTP - the self-hosting default - a browser sends another
     * site's <img>, link or no-cors fetch with neither Origin nor
     * Sec-Fetch-Site, so the check above cannot see where it came from. It
     * cannot add a header, though, and the form's page always does.
     */
    it("refuses a read another site's <img> sends over plain HTTP, from inside the allowlist, before anything counts it", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(LOCKED_SHARE_KEY),
        clientIp: ALLOWED_IP,
        withoutPageHeader: true,
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE);
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
      expect(getPublicForm).not.toHaveBeenCalled();
      expect(client.counters.size).toBe(0);
    });

    /*
     * Six hundred and one images with made-up links, loaded by one
     * visitor's browser in a loop: counted, they would have used up the 600
     * reads a minute everybody behind that address shares, and a colleague
     * opening a real form would be told to wait.
     */
    it("cannot use up the read budget of the address it sends from", async () => {
      for (let attempt: number = 0; attempt < 601; attempt++) {
        const refused: HttpResult = await send({
          port,
          method: "GET",
          path: readPath(ObjectID.generate().toString()),
          clientIp: ALLOWED_IP,
          withoutPageHeader: true,
        });

        expect(refused.status).toBe(403);
      }

      // The page's own read, as a browser sends it over plain HTTP.
      const colleague: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
        clientIp: ALLOWED_IP,
      });

      expect(seen(colleague)).toEqual({ status: 200, body: PUBLIC_FORM });

      // Only the colleague's read was counted: by address, and by form and address.
      expect(
        client
          .keysMatching(`:read:i:${ALLOWED_IP}:`)
          .map((key: string): number => {
            return client.counters.get(key)!;
          }),
      ).toEqual([1]);
      expect(Array.from(client.counters.values())).toEqual([1, 1]);
    }, 60_000);

    /*
     * What a browser really sends with the page's own read: a GET to its own
     * origin carries no Origin, and over plain HTTP no Sec-Fetch-Site either
     * - only the page's header says where it came from. Over HTTPS the
     * browser adds Sec-Fetch-Site: same-origin.
     */
    it.each([
      ["over plain HTTP: the page's header and nothing else", {}],
      ["over HTTPS", { "sec-fetch-site": "same-origin" }],
    ])(
      "serves the form page's own read %s",
      async (_label: string, headers: http.OutgoingHttpHeaders) => {
        const result: HttpResult = await send({
          port,
          method: "GET",
          path: readPath(LOCKED_SHARE_KEY),
          clientIp: ALLOWED_IP,
          headers: headers,
        });

        expect(seen(result)).toEqual({ status: 200, body: PUBLIC_FORM });
      },
    );

    /*
     * Opening the read's own address in the address bar is a navigation:
     * the browser says the visitor made it (Sec-Fetch-Site: none), but it
     * carries no header of a page's, so it is not the form's page reading.
     */
    it("refuses the read's address opened in the address bar", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
        headers: { "sec-fetch-site": "none" },
        withoutPageHeader: true,
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE);
      expect(client.counters.size).toBe(0);
    });

    /*
     * The page's header is asked of a read only. A submission cannot come
     * from another site's page unnoticed - every POST carries its Origin,
     * and a JSON body is preflighted - so a caller that is not a browser
     * submits without it.
     */
    it("takes a submission without the page's header", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        withoutPageHeader: true,
        body: { data: ANSWERS },
      });

      expect(seen(result)).toEqual({ status: 200, body: SUBMISSION_RESULT });
    });

    it("takes the JSON the page's API client sends, charset and all", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        headers: {
          ...OWN_PAGE,
          "content-type": "application/json;charset=UTF-8",
        },
        rawBody: JSON.stringify({ data: ANSWERS }),
      });

      expect(seen(result)).toEqual({ status: 200, body: SUBMISSION_RESULT });
    });

    it.each([
      ["from the form's own page", OWN_PAGE],
      ["from a caller that is not a browser", {}],
    ])(
      "refuses a submission that is not JSON %s, before anything counts it",
      async (_label: string, headers: http.OutgoingHttpHeaders) => {
        for (const contentType of [
          "application/x-www-form-urlencoded",
          "text/plain",
        ]) {
          const result: HttpResult = await send({
            port,
            method: "POST",
            path: submitPath(SHARE_KEY),
            headers: { ...headers, "content-type": contentType },
            rawBody: FORGED_FORM,
          });

          expect(result.status).toBe(400);
          expect(errorMessageOf(result)).toBe(
            INCIDENT_FORM_SUBMISSION_BODY_MESSAGE,
          );
        }

        expect(submitPublicForm).not.toHaveBeenCalled();
        expect(incidentCreate).not.toHaveBeenCalled();
        expect(client.counters.size).toBe(0);
      },
    );
  });

  describe("404", () => {
    it.each([
      ["a link no form holds", UNKNOWN_SHARE_KEY],
      ["a form that is turned off", OFF_SHARE_KEY],
      ["a link that is not a share key", "report-a-problem"],
    ])(
      "answers %s with the one not-available message",
      async (_label: string, shareKey: string) => {
        const read: HttpResult = await send({
          port,
          method: "GET",
          path: readPath(shareKey),
        });
        const submitted: HttpResult = await send({
          port,
          method: "POST",
          path: submitPath(shareKey),
          body: { data: ANSWERS },
        });

        for (const result of [read, submitted]) {
          expect(result.status).toBe(404);
          expect(errorMessageOf(result)).toBe(
            INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
          );
        }

        expect(incidentCreate).not.toHaveBeenCalled();
      },
    );

    it("answers a project off plan exactly as a link no form holds", async () => {
      jest
        .spyOn(IncidentFormService, "isProjectOnPlan")
        .mockResolvedValue(false as never);

      const offPlan: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
      });
      const unknown: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(UNKNOWN_SHARE_KEY),
      });

      expect(seen(offPlan)).toEqual(seen(unknown));
      expect(offPlan.status).toBe(404);
    });
  });

  describe("429", () => {
    it("refuses a caller over the read limit, saying when to come back", async () => {
      client.countFloor = 10_000;

      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
      });

      expect(result.status).toBe(429);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_READ_RATE_LIMIT_MESSAGE,
      );
      expect(Number(result.headers["retry-after"])).toBeGreaterThan(0);
      expect(getPublicForm).not.toHaveBeenCalled();
    });

    it("refuses a caller over the submission limit, declaring nothing", async () => {
      for (let i: number = 0; i < 10; i++) {
        expect(
          (
            await send({
              port,
              method: "POST",
              path: submitPath(SHARE_KEY),
              body: { data: ANSWERS },
            })
          ).status,
        ).toBe(200);
      }

      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: ANSWERS },
      });

      expect(result.status).toBe(429);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_SUBMIT_RATE_LIMIT_MESSAGE,
      );
      expect(Number(result.headers["retry-after"])).toBeGreaterThan(0);
      expect(incidentCreate).toHaveBeenCalledTimes(10);
    });
  });

  /*
   * The form's hourly ceiling - sixty incidents across every address -
   * bounds the pages a leaked link can cause. Only a submission that passed
   * every check spends it: if refused requests did, anyone holding the link
   * - even from outside the IP allowlist, or without solving the captcha -
   * could use it up with requests that declare nothing, and lock the form
   * for everybody, silently, hour after hour.
   */
  describe("the form's hourly ceiling", () => {
    // Ten requests from each of six addresses: within each one's own budget.
    async function sendFromSixAddresses(data: {
      firstOctet: number;
      shareKey: string;
      body: unknown;
    }): Promise<Array<number>> {
      const statuses: Array<number> = [];

      for (let address: number = 1; address <= 6; address++) {
        for (let attempt: number = 0; attempt < 10; attempt++) {
          statuses.push(
            (
              await send({
                port,
                method: "POST",
                path: submitPath(data.shareKey),
                clientIp: `${data.firstOctet}.0.0.${address}`,
                body: data.body,
              })
            ).status,
          );
        }
      }

      return statuses;
    }

    test("is never spent by requests the IP allowlist, the captcha or the answers refuse", async () => {
      // Outside the form's allowlist (198.51.100.0/24).
      expect(
        new Set(
          await sendFromSixAddresses({
            firstOctet: 11,
            shareKey: LOCKED_SHARE_KEY,
            body: { data: ANSWERS },
          }),
        ),
      ).toEqual(new Set([403]));

      // A captcha that fails.
      jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(true);
      jest
        .spyOn(CaptchaUtil, "verifyCaptcha")
        .mockRejectedValue(
          new BadDataException(
            "Captcha verification failed. Please try again.",
          ),
        );

      expect(
        new Set(
          await sendFromSixAddresses({
            firstOctet: 12,
            shareKey: LOCKED_SHARE_KEY,
            body: { data: ANSWERS },
          }),
        ),
      ).toEqual(new Set([403]));
      expect(
        new Set(
          await sendFromSixAddresses({
            firstOctet: 12,
            shareKey: SHARE_KEY,
            body: { data: ANSWERS },
          }),
        ),
      ).toEqual(new Set([400]));

      jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);

      // Bodies that are not a submission, and answers that do not pass.
      expect(
        new Set(
          await sendFromSixAddresses({
            firstOctet: 13,
            shareKey: SHARE_KEY,
            body: {},
          }),
        ),
      ).toEqual(new Set([400]));
      expect(
        new Set(
          await sendFromSixAddresses({
            firstOctet: 14,
            shareKey: SHARE_KEY,
            body: { data: { reporterName: "No title" } },
          }),
        ),
      ).toEqual(new Set([400]));

      expect(incidentCreate).not.toHaveBeenCalled();
      expect(client.keysMatching(":submit:f:")).toEqual([]);

      // The office inside the allowlist can still report.
      const insider: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(LOCKED_SHARE_KEY),
        clientIp: ALLOWED_IP,
        body: { data: ANSWERS },
      });

      expect(seen(insider)).toEqual({ status: 200, body: SUBMISSION_RESULT });
      expect(incidentCreate).toHaveBeenCalledTimes(1);
      expect(client.keysMatching(":submit:f:")).toHaveLength(1);
    }, 60_000);

    test("declares at most sixty incidents an hour, from however many addresses", async () => {
      for (let address: number = 1; address <= 60; address++) {
        expect(
          (
            await send({
              port,
              method: "POST",
              path: submitPath(SHARE_KEY),
              clientIp: `10.3.0.${address}`,
              body: { data: ANSWERS },
            })
          ).status,
        ).toBe(200);
      }

      const refused: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        clientIp: "10.3.1.1",
        body: { data: ANSWERS },
      });

      expect(refused.status).toBe(429);
      expect(errorMessageOf(refused)).toBe(
        INCIDENT_FORM_TOTAL_RATE_LIMIT_MESSAGE,
      );
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(Number(refused.headers["retry-after"])).toBeLessThanOrEqual(
        60 * 60,
      );
      expect(incidentCreate).toHaveBeenCalledTimes(60);
    }, 60_000);

    test("refuses with a 503, declaring nothing, when it cannot be counted", async () => {
      client.failKeysMatching = /:submit:f:/;

      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: ANSWERS },
      });

      expect(result.status).toBe(503);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
      expect(incidentCreate).not.toHaveBeenCalled();
    });
  });

  describe("503", () => {
    it("refuses submissions while the rate limit counter is unavailable", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        body: { data: ANSWERS },
      });

      expect(result.status).toBe(503);
      expect(errorMessageOf(result)).toBe(
        INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
      expect(submitPublicForm).not.toHaveBeenCalled();
      expect(incidentCreate).not.toHaveBeenCalled();
    });

    it("still shows the form while the counter is unavailable", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
      });

      expect(seen(result)).toEqual({ status: 200, body: PUBLIC_FORM });
    });
  });

  describe("a visitor's own OneUptime session never gets in the way", () => {
    const deadSessions: Array<
      [string, Dictionary<string>, http.OutgoingHttpHeaders]
    > = [
      [
        "an access-token cookie from before a secret rotation",
        { [CookieUtil.getUserTokenKey()]: STALE_ACCESS_TOKEN },
        {},
      ],
      [
        "an expired access-token cookie",
        { [CookieUtil.getUserTokenKey()]: EXPIRED_ACCESS_TOKEN },
        {},
      ],
      [
        "a junk access-token cookie",
        { [CookieUtil.getUserTokenKey()]: "not-a-jwt" },
        {},
      ],
      ["a junk bearer token", {}, { authorization: "Bearer not-a-jwt" }],
    ];

    it.each(deadSessions)(
      "answers a request carrying %s exactly as one carrying none",
      async (
        _label: string,
        cookies: Dictionary<string>,
        headers: http.OutgoingHttpHeaders,
      ) => {
        for (const [method, path, body] of [
          ["GET", readPath(SHARE_KEY), undefined],
          ["POST", submitPath(SHARE_KEY), { data: ANSWERS }],
          ["GET", readPath(OFF_SHARE_KEY), undefined],
          ["POST", submitPath(SHARE_KEY), { data: { title: "" } }],
        ] as Array<["GET" | "POST", string, unknown]>) {
          const withSession: HttpResult = await send({
            port,
            method,
            path,
            cookies,
            headers,
            body,
          });
          const withoutSession: HttpResult = await send({
            port,
            method,
            path,
            body,
          });

          expect(withSession.status).not.toBe(401);
          expect(seen(withSession)).toEqual(seen(withoutSession));
        }
      },
    );

    /*
     * Nothing on these routes touches the visitor's cookies, so nothing can
     * sign them out of the session they have on this host.
     */
    it.each(deadSessions)(
      "never sets or clears a cookie for a request carrying %s",
      async (
        _label: string,
        cookies: Dictionary<string>,
        headers: http.OutgoingHttpHeaders,
      ) => {
        const read: HttpResult = await send({
          port,
          method: "GET",
          path: readPath(SHARE_KEY),
          cookies,
          headers,
        });
        const submitted: HttpResult = await send({
          port,
          method: "POST",
          path: submitPath(SHARE_KEY),
          cookies,
          headers,
          body: { data: ANSWERS },
        });

        expect(read.headers["set-cookie"]).toBeUndefined();
        expect(submitted.headers["set-cookie"]).toBeUndefined();
      },
    );

    it("treats a signed-in visitor as just a visitor: the same answer, and an incident that names no user", async () => {
      const cookies: Dictionary<string> = {
        [CookieUtil.getUserTokenKey()]: validAccessToken(),
      };

      const read: HttpResult = await send({
        port,
        method: "GET",
        path: readPath(SHARE_KEY),
        cookies,
      });
      const submitted: HttpResult = await send({
        port,
        method: "POST",
        path: submitPath(SHARE_KEY),
        cookies,
        body: { data: ANSWERS },
      });

      expect(seen(read)).toEqual({ status: 200, body: PUBLIC_FORM });
      expect(seen(submitted)).toEqual({ status: 200, body: SUBMISSION_RESULT });
      expect(submitted.headers["set-cookie"]).toBeUndefined();

      const created: { data: Incident; props: JSONObject } = incidentCreate.mock
        .calls[0]![0] as { data: Incident; props: JSONObject };

      expect(created.data.createdByUserId).toBeUndefined();
      expect(created.props).toEqual({ isRoot: true });
      expect(
        Object.keys(
          getPublicForm.mock.calls[0]![0] as Record<string, unknown>,
        ).sort(),
      ).toEqual(["clientIp", "shareKey"]);
    });

    /*
     * The CRUD routes on the same router do need to know who is calling, so
     * a dead session is still a 401 there - the answer that makes the
     * dashboard client refresh its session. Only the public routes waive it.
     */
    it("still answers the signed-in CRUD routes beside them with a 401", async () => {
      for (const [method, path] of [
        ["POST", "/api/incident-form/get-list"],
        [
          "POST",
          `/api/incident-form/${ObjectID.generate().toString()}/get-item`,
        ],
      ] as Array<["GET" | "POST", string]>) {
        const result: HttpResult = await send({
          port,
          method,
          path,
          cookies: { [CookieUtil.getUserTokenKey()]: STALE_ACCESS_TOKEN },
          body: {},
        });

        expect(result.status).toBe(401);
        expect(errorMessageOf(result)).toBe(INVALID_ACCESS_TOKEN_MESSAGE);
      }
    });
  });
});

/*
 * Route matching, read from the router itself. The public routes sit beside
 * the model's CRUD routes under /incident-form; neither may ever catch the
 * other's requests. Express matches in registration order, and BaseAPI
 * registers the CRUD routes first.
 */
describe("the public routes and the CRUD routes never collide", () => {
  type RouteHandler = (...args: Array<unknown>) => unknown;

  interface RouterLayer {
    route?: {
      path: string;
      methods: Dictionary<boolean>;
      stack: Array<{ handle: RouteHandler }>;
    };
    match: (path: string) => boolean;
  }

  const router: ExpressRouter = new IncidentFormAPI().getRouter();
  const layers: Array<RouterLayer> = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.filter((layer: RouterLayer) => {
    return Boolean(layer.route);
  });

  // Every registered route that would answer this request, in order.
  function routesFor(method: string, path: string): Array<string> {
    return layers
      .filter((layer: RouterLayer) => {
        return (
          Boolean(layer.route!.methods[method.toLowerCase()]) &&
          layer.match(path)
        );
      })
      .map((layer: RouterLayer) => {
        return `${method} ${layer.route!.path}`;
      });
  }

  function firstMiddlewareFor(method: string, path: string): unknown {
    const layer: RouterLayer | undefined = layers.find(
      (candidate: RouterLayer) => {
        return (
          Boolean(candidate.route!.methods[method.toLowerCase()]) &&
          candidate.match(path)
        );
      },
    );

    return layer?.route?.stack[0]?.handle;
  }

  const shareKey: string = ObjectID.generate().toString();
  const id: string = ObjectID.generate().toString();

  it("sends a form link only to the public routes", () => {
    expect(routesFor("GET", `/incident-form/public/${shareKey}`)).toEqual([
      "GET /incident-form/public/:shareKey",
    ]);
    expect(
      routesFor("POST", `/incident-form/public/${shareKey}/submit`),
    ).toEqual(["POST /incident-form/public/:shareKey/submit"]);
  });

  it.each([
    ["POST", "/incident-form"],
    ["POST", "/incident-form/get-list"],
    ["GET", "/incident-form/get-list"],
    ["POST", "/incident-form/count"],
    ["POST", `/incident-form/${id}/get-item`],
    ["GET", `/incident-form/${id}/get-item`],
    ["PUT", `/incident-form/${id}`],
    ["POST", `/incident-form/${id}/update-item`],
    ["DELETE", `/incident-form/${id}`],
    ["POST", `/incident-form/${id}/delete-item`],
  ])(
    "sends %s %s only to its CRUD route, behind the signed-in user middleware",
    (method: string, path: string) => {
      const matched: Array<string> = routesFor(method, path);

      expect(matched).toHaveLength(1);
      expect(matched[0]).not.toContain("/public/");
      expect(firstMiddlewareFor(method, path)).toBe(
        UserMiddleware.getUserMiddleware,
      );
    },
  );

  /*
   * A share key is a UUID, so it is never "get-item". Were one spelled like
   * a CRUD suffix, the CRUD route - registered first - would take it, with
   * its authentication: never the other way round.
   */
  it("lets the CRUD route win the one path both could match", () => {
    expect(routesFor("GET", "/incident-form/public/get-item")).toEqual([
      "GET /incident-form/:id/get-item",
      "GET /incident-form/public/:shareKey",
    ]);
    expect(firstMiddlewareFor("GET", "/incident-form/public/get-item")).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });
});
