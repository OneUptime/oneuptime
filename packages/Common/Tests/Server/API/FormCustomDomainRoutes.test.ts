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

import FormAPI, {
  FORM_CUSTOM_DOMAIN_TOKEN_MESSAGE,
  FORM_FOREIGN_PAGE_MESSAGE,
  FORM_SUBMISSION_BODY_MESSAGE,
} from "../../../Server/API/FormAPI";
import Redis from "../../../Server/Infrastructure/Redis";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import FormDomainService from "../../../Server/Services/FormDomainService";
import FormService, {
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import SameOriginRequest from "../../../Server/Utils/SameOriginRequest";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Form from "../../../Models/DatabaseModels/Form";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
} from "../../../Types/Form/FormField";
import {
  FORM_CUSTOM_DOMAIN_API_PATH,
  FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_API_PATH,
  FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH,
} from "../../../Types/Form/FormCustomDomain";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
} from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
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

// Express hands a refusal on with setImmediate, which jsdom lacks.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A form on its owner's own domain, over HTTP: the routes its page calls on
 * that domain (FormAPI, Types/Form/FormCustomDomain) through a real Express
 * app with the JSON body parser and the production error handler - the real
 * FormAPI router, the real own-page checks, the real limiter and the real
 * FormService. Only the tables (a form domain's name and its form's key, the
 * forms), the incident it creates, the captcha provider and Redis are
 * stand-ins.
 *
 * What it pins:
 *
 *   - the form is the one the domain the request came to answers with -
 *     found by the request's own Host, never by X-Forwarded-Host or any key
 *     a request names - and a name no form has gets the one answer every
 *     unavailable form gets;
 *   - a page on another site, or on another of the customer's own
 *     subdomains, or on OneUptime's own domain, is refused before anything
 *     is counted or looked up; the page on the domain is let through;
 *   - reading needs the form page's own header, submitting needs JSON, and
 *     both are counted per form by the domain (d:<domain>);
 *   - a form that is off answers its domain as it answers its link;
 *   - the CNAME check answers its own token on its own domain only.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000e1";
const SHARE_KEY: string = "8c9e6679-7425-40de-944b-e07fc1f90ae7";
const OFF_SHARE_KEY: string = "8c9e6679-7425-40de-944b-e07fc1f90ae8";
const SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000e1";
const INCIDENT_ID: string = "e0000000-0000-4000-8000-0000000000e1";
const TOKEN: string = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

// The customer's domains: one shows the form, one shows a form that is off.
const FORM_DOMAIN: string = "report.acme.com";
const OFF_FORM_DOMAIN: string = "closed.acme.com";

const INSTANCE_ORIGIN: string = "https://oneuptime.example.com";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

// A counting Redis, as the limiter's pipelines use it.
class FakeRedisClient {
  public counters: Map<string, number> = new Map();

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
    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "Title",
    isRequired: true,
  },
  {
    id: "email",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Email,
    label: "Your Email",
    isRequired: true,
  },
];

function buildForm(data: { shareKey: string; isEnabled?: boolean }): Form {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = data.isEnabled !== false;
  form.shareKey = new ObjectID(data.shareKey);
  form.targetType = FormTargetType.Incident;
  form.fields = FIELDS as unknown as JSONObject[];
  form.targetSettings = { incidentSeverityId: SEVERITY_ID };
  form.successMessage = "Thanks - we are on it.";
  form.ipWhitelist = "";
  return form;
}

const FORMS: Array<Form> = [
  buildForm({ shareKey: SHARE_KEY }),
  buildForm({ shareKey: OFF_SHARE_KEY, isEnabled: false }),
];

// The form domains: a name, its form's key and its CNAME token.
const FORM_DOMAINS: Array<{ name: string; shareKey: string; token: string }> = [
  { name: FORM_DOMAIN, shareKey: SHARE_KEY, token: TOKEN },
  {
    name: OFF_FORM_DOMAIN,
    shareKey: OFF_SHARE_KEY,
    token: "2c5f39cb-3fb2-42e3-994f-1127e4ddb538",
  },
];

const ANSWERS: JSONObject = {
  answers: {
    title: "Checkout is down",
    email: "jane@example.com",
  },
};

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  // The Host the request names: the name the browser connected to.
  host: string;
  headers?: http.OutgoingHttpHeaders | undefined;
  withoutPageHeader?: boolean | undefined;
  body?: unknown;
  rawBody?: string | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" && data.body !== undefined
          ? JSON.stringify(data.body)
          : "";

      const headers: http.OutgoingHttpHeaders = {
        host: data.host,
        tenantid: "",
        ...(data.withoutPageHeader
          ? {}
          : { [FORM_PAGE_HEADER]: FORM_PAGE_HEADER_VALUE }),
        "x-forwarded-for": "198.51.100.23",
        ...(data.headers || {}),
      };

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

function errorMessageOf(result: HttpResult): unknown {
  return result.body?.["message"] ?? result.body?.["error"];
}

describe("a form's routes on its own domain, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let client: FakeRedisClient;
  let incidentCreate: MockedFn;
  let domainLookups: Array<{ query: Record<string, unknown> }>;

  // The routes, as the browser and the ingress see them.
  const READ: string = FORM_CUSTOM_DOMAIN_API_PATH;
  const SUBMIT: string = FORM_CUSTOM_DOMAIN_SUBMIT_API_PATH;
  const CNAME: string = FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_API_PATH;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(CookieParser());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use("/api", new FormAPI().getRouter());
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
    domainLookups = [];

    // The form domains table: a name, while its parent domain is verified.
    jest
      .spyOn(FormDomainService, "findOneBy")
      .mockImplementation((async (findBy: {
        query: Record<string, unknown>;
      }) => {
        domainLookups.push(findBy);

        const found:
          | { name: string; shareKey: string; token: string }
          | undefined = FORM_DOMAINS.find(
          (domain: { name: string; token: string }) => {
            if (domain.name !== findBy.query["fullDomain"]) {
              return false;
            }

            const token: unknown = findBy.query["cnameVerificationToken"];

            return token === undefined || token === domain.token;
          },
        );

        if (!found) {
          return null;
        }

        return {
          _id: ObjectID.generate().toString(),
          form: { _id: FORM_ID, shareKey: found.shareKey },
        };
      }) as never);

    jest.spyOn(FormService, "findOneBy").mockImplementation((async (findBy: {
      query: { shareKey?: ObjectID };
    }): Promise<Form | null> => {
      return (
        FORMS.find((form: Form) => {
          return (
            form.shareKey?.toString() === findBy.query.shareKey?.toString()
          );
        }) || null
      );
    }) as never);

    jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true as never);
    jest.spyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockImplementation((async (): Promise<IncidentSeverity> => {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = SEVERITY_ID;
        severity.projectId = PROJECT_ID;
        return severity;
      }) as never);

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
      .spyOn(FormSubmissionService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);
    jest
      .spyOn(IncidentInternalNoteService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);

    jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);

    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    jest.spyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    jest.spyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("reading the form", () => {
    it("answers with the form the domain the request came to shows, uncached", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: FORM_DOMAIN,
      });

      expect(result.status).toBe(200);
      expect(result.body?.["name"]).toBe("Report a Problem");
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );

      // Found by its name, as the Host said it, while its domain is verified.
      expect(domainLookups[0]!.query["fullDomain"]).toBe(FORM_DOMAIN);
      expect(domainLookups[0]!.query["domain"]).toEqual(
        expect.objectContaining({ isVerified: true }),
      );
    });

    it("finds the form by the Host in any case and with its port, as browsers send it", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: "Report.ACME.com:443",
      });

      expect(result.status).toBe(200);
      expect(domainLookups[0]!.query["fullDomain"]).toBe(FORM_DOMAIN);
    });

    it("never by X-Forwarded-Host, which a caller writes", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: "unknown.example.com",
        headers: { "x-forwarded-host": FORM_DOMAIN },
      });

      expect(result.status).toBe(404);
      expect(errorMessageOf(result)).toBe(FORM_NOT_AVAILABLE_MESSAGE);
      expect(
        domainLookups.map((lookup: { query: Record<string, unknown> }) => {
          return lookup.query["fullDomain"];
        }),
      ).not.toContain(FORM_DOMAIN);
    });

    it("never by a share key the request names", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `${READ}?shareKey=${SHARE_KEY}`,
        host: "unknown.example.com",
      });

      expect(result.status).toBe(404);
      expect(errorMessageOf(result)).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    });

    it("a name no form has gets the one answer every unavailable form gets", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: "status.acme.com",
      });

      expect(result.status).toBe(404);
      expect(errorMessageOf(result)).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    });

    it("a form that is off answers its domain as it answers its link", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: OFF_FORM_DOMAIN,
      });

      expect(result.status).toBe(404);
      expect(errorMessageOf(result)).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    });

    it("needs the form page's own header, before anything is counted", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: FORM_DOMAIN,
        withoutPageHeader: true,
      });

      expect(result.status).toBe(403);
      expect(errorMessageOf(result)).toBe(FORM_FOREIGN_PAGE_MESSAGE);
      expect(client.counters.size).toBe(0);
      expect(domainLookups).toHaveLength(0);
    });

    it("is counted per form by the domain, never by a share key", async () => {
      await send({ port, method: "GET", path: READ, host: FORM_DOMAIN });

      expect(client.keysMatching(`d:${FORM_DOMAIN}`).length).toBeGreaterThan(0);
      expect(client.keysMatching(SHARE_KEY)).toEqual([]);
    });
  });

  describe("the pages that may call them", () => {
    it.each([
      ["the domain's own page", { origin: `https://${FORM_DOMAIN}` }],
      ["the page, over plain HTTP", { origin: `http://${FORM_DOMAIN}` }],
      ["a request with no page at all", {}],
      ["a same-origin fetch", { "sec-fetch-site": "same-origin" }],
    ])("lets %s through", async (_label: string, headers: object) => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: READ,
        host: FORM_DOMAIN,
        headers: headers as http.OutgoingHttpHeaders,
      });

      expect(result.status).toBe(200);
    });

    it.each([
      ["another site's page", { origin: "https://evil.example" }],
      [
        "another of the customer's own subdomains",
        { origin: "https://status.acme.com" },
      ],
      ["OneUptime's own domain", { origin: INSTANCE_ORIGIN }],
      ["a page that hides its origin", { origin: "null" }],
      ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
      ["a same-site fetch", { "sec-fetch-site": "same-site" }],
    ])(
      "refuses %s, before anything is counted or looked up",
      async (_label: string, headers: object) => {
        for (const method of ["GET", "POST"] as const) {
          const result: HttpResult = await send({
            port,
            method: method,
            path: method === "GET" ? READ : SUBMIT,
            host: FORM_DOMAIN,
            headers: headers as http.OutgoingHttpHeaders,
            body: method === "POST" ? { data: ANSWERS } : undefined,
          });

          expect([method, result.status]).toEqual([method, 403]);
          expect(errorMessageOf(result)).toBe(FORM_FOREIGN_PAGE_MESSAGE);
        }

        expect(client.counters.size).toBe(0);
        expect(domainLookups).toHaveLength(0);
        expect(incidentCreate).not.toHaveBeenCalled();
      },
    );
  });

  describe("submitting the form", () => {
    it("creates what the form is for, in the form's project, and answers with its number", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: SUBMIT,
        host: FORM_DOMAIN,
        headers: { origin: `https://${FORM_DOMAIN}` },
        body: { data: ANSWERS },
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        reference: "INC-42",
        successMessage: "Thanks - we are on it.",
      });
      expect(incidentCreate).toHaveBeenCalledTimes(1);

      const created: Incident = (
        incidentCreate.mock.calls[0]![0] as { data: Incident }
      ).data;

      expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(created.title).toBe("Checkout is down");
      expect(client.keysMatching(`d:${FORM_DOMAIN}`).length).toBeGreaterThan(0);
    });

    it("must be JSON, as the page sends it", async () => {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: SUBMIT,
        host: FORM_DOMAIN,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        rawBody: "data[answers][title]=Checkout",
      });

      expect(result.status).toBe(400);
      expect(errorMessageOf(result)).toBe(FORM_SUBMISSION_BODY_MESSAGE);
      expect(incidentCreate).not.toHaveBeenCalled();
    });

    it.each([
      ["no form has the name", "status.acme.com"],
      ["its form is off", OFF_FORM_DOMAIN],
    ])(
      "is refused as not available when %s, and creates nothing",
      async (_label: string, host: string) => {
        const result: HttpResult = await send({
          port,
          method: "POST",
          path: SUBMIT,
          host: host,
          body: { data: ANSWERS },
        });

        expect(result.status).toBe(404);
        expect(errorMessageOf(result)).toBe(FORM_NOT_AVAILABLE_MESSAGE);
        expect(incidentCreate).not.toHaveBeenCalled();
      },
    );
  });

  describe("the CNAME check", () => {
    it("answers its own token on its own domain, with no page headers", async () => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `${CNAME}/${TOKEN}`,
        host: FORM_DOMAIN,
        withoutPageHeader: true,
      });

      expect(result.status).toBe(200);
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
    });

    it.each([
      ["another domain's token", FORM_DOMAIN, FORM_DOMAINS[1]!.token],
      ["its token on another name", "status.acme.com", TOKEN],
      ["a token that is no token", FORM_DOMAIN, "not-a-token"],
    ])("refuses %s", async (_label: string, host: string, token: string) => {
      const result: HttpResult = await send({
        port,
        method: "GET",
        path: `${CNAME}/${encodeURIComponent(token)}`,
        host: host,
        withoutPageHeader: true,
      });

      expect(result.status).toBe(400);
      expect(errorMessageOf(result)).toBe(FORM_CUSTOM_DOMAIN_TOKEN_MESSAGE);
    });

    it("is never counted: the sweeps make it, not visitors", async () => {
      await send({
        port,
        method: "GET",
        path: `${CNAME}/${TOKEN}`,
        host: FORM_DOMAIN,
        withoutPageHeader: true,
      });

      expect(client.counters.size).toBe(0);
    });
  });
});
