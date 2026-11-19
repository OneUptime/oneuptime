jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import DomainAPI from "../../../Server/API/DomainAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DomainService, {
  DOMAIN_NAME_REFUSAL_MESSAGE,
} from "../../../Server/Services/DomainService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DomainModel from "../../../Models/DatabaseModels/Domain";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DomainType from "../../../Types/Domain";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * ADDING A PROJECT'S DOMAIN THROUGH THE API, IN EVERY FORM IT ARRIVES IN
 * (#9997).
 *
 * Add Custom Domain - a status page's, a dashboard's or a form's - adds the
 * address's domain to the project when the project does not have it yet.
 * The Dashboard sends that domain as it sends every Domain value, as the
 * JSON of one: { "_type": "Domain", "value": "customer.com" }, which is
 * also how the API reference documents the column. The server reads that
 * JSON back as a Domain of the shared class (Common/Types/Domain), and the
 * create hook took only text or an instance of the server's own subclass
 * of it (Common/Server/Types/Domain). So the server refused every such
 * domain with "Domain must be a string or an instance of Domain.": every
 * address on a domain the project did not have yet, from the dialog's first
 * release in 14.0.109, and every create in the documented JSON form since
 * the check was written. Settings > Domains and Terraform send text, and
 * kept working - which is why nothing caught it.
 *
 * Each form goes here through the real route over HTTP: Express's JSON
 * body parser, DomainAPI, the permission layer, DomainService's hooks and
 * the error handler the server answers with, into a table held in memory.
 * The Dashboard's own request is sent by the Dashboard's own code
 * (ModelAPI.create), so the test reads what the browser sends, not what a
 * test author thinks it sends.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99970000-0000-4000-8000-000000000001",
);
const DOMAIN_ID: string = "99970000-0000-4000-8000-0000000000d1";

const VERIFICATION_TEXT: RegExp = /^oneuptime-verification-.{20}$/;

let server: DashboardRequestsOverHttp;
let table: InMemoryTable;
let caller: DatabaseCommonInteractionProps;

// What Postgres is handed for `value` in the domain column: its transformer's output.
function storedName(value: unknown): unknown {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .filterColumns(DomainModel)
    .find((args: ColumnMetadataArgs): boolean => {
      return args.propertyName === "domain";
    });

  expect(column).toBeDefined();

  return (column!.options.transformer as ValueTransformer).to(value);
}

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

// What the server answered a refusal with, as the Dashboard reads it.
function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);

  return String(answer["error"] || answer["message"] || "");
}

// POST /api/domain with `domain` as it would arrive from an API caller.
async function postDomain(domain: unknown): Promise<SentRequest> {
  return await server.request("POST", "/api/domain", {
    data: {
      domain: domain,
      projectId: PROJECT_ID.toString(),
    },
    miscDataProps: {},
  });
}

// PUT /api/domain/:id with `domain` as it would arrive from an API caller.
async function renameDomain(domain: unknown): Promise<SentRequest> {
  return await server.request("PUT", `/api/domain/${DOMAIN_ID}`, {
    data: {
      domain: domain,
    },
  });
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([new DomainAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;

  stubProjectDirectory({});

  caller = {
    ...customDomainCaller({
      permissions: [Permission.ProjectAdmin],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  // The Dashboard's headers name the session's project; the caller above is it.
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  table = useInMemoryTable(DomainService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/domain, as Add Custom Domain sends it", () => {
  test("the dialog's request adds the domain: lower-cased, not verified, with a verification text the server chose", async () => {
    // As AddCustomDomainModal builds the project's domain it is missing.
    const domain: DomainModel = new DomainModel();
    domain.domain = new DomainType("Customer.com");
    domain.projectId = PROJECT_ID;

    await ModelAPI.create<DomainModel>({
      model: domain,
      modelType: DomainModel,
    });

    const sent: Array<SentRequest> = server.sentTo("POST", "/api/domain");
    expect(sent).toHaveLength(1);

    // What went over the wire: the domain as the JSON of a Domain.
    const data: JSONObject = (sent[0]!.body as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["domain"]).toEqual({ _type: "Domain", value: "Customer.com" });

    expect(sent[0]!.status).toBe(200);
    expect(table.inserts).toHaveLength(1);

    const row: StoredRow = table.inserts[0]!;
    expect(storedName(row["domain"])).toBe("customer.com");
    expect(String(row["projectId"])).toBe(PROJECT_ID.toString());
    expect(row["isVerified"]).toBeFalsy();
    expect(String(row["domainVerificationText"])).toMatch(VERIFICATION_TEXT);

    // And what the dialog reads back: the name it is stored under.
    expect(answerOf(sent[0]!)["domain"]).toEqual({
      _type: "Domain",
      value: "customer.com",
    });
  });

  test("the dialog's request for a domain the project has already is refused as a name in use, not as a value the server cannot read", async () => {
    table.rows.push({
      _id: DOMAIN_ID,
      projectId: PROJECT_ID.toString(),
      domain: new DomainType("customer.com"),
      slug: "customer-com",
      isVerified: false,
      domainVerificationText: "oneuptime-verification-abcdefghij0123456789",
    });

    const domain: DomainModel = new DomainModel();
    domain.domain = new DomainType("customer.com");
    domain.projectId = PROJECT_ID;

    await expect(
      ModelAPI.create<DomainModel>({ model: domain, modelType: DomainModel }),
    ).rejects.toBeDefined();

    const sent: SentRequest = server.sentTo("POST", "/api/domain")[0]!;

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).not.toBe(DOMAIN_NAME_REFUSAL_MESSAGE);
    expect(refusalOf(sent)).not.toContain("instance of Domain");
    expect(table.inserts).toHaveLength(0);
  });
});

describe("POST /api/domain, as the other ways to add a domain send it", () => {
  test("Settings > Domains' request, as its form sends it, adds the domain", async () => {
    /*
     * As ModelForm builds a Create form's model: the field's text, read
     * into the model as it is (BaseModel.fromJSON), and sent by
     * ModelAPI.createOrUpdate. A Domain field is not turned into a Domain,
     * so this form sends text.
     */
    const model: DomainModel = BaseModel.fromJSON(
      { domain: "Customer.com", projectId: PROJECT_ID.toString() },
      DomainModel,
    ) as DomainModel;

    await ModelAPI.createOrUpdate<DomainModel>({
      model: model,
      modelType: DomainModel,
      formType: FormType.Create,
    });

    const sent: SentRequest = server.sentTo("POST", "/api/domain")[0]!;
    const data: JSONObject = (sent.body as JSONObject)["data"] as JSONObject;

    expect(data["domain"]).toBe("Customer.com");
    expect(sent.status).toBe(200);
    expect(table.inserts).toHaveLength(1);
    expect(storedName(table.inserts[0]!["domain"])).toBe("customer.com");
  });

  test("Terraform's request, as its provider sends it, adds the domain, verified at once on a reserved test domain", async () => {
    /*
     * The provider sends a string attribute as it is when it is not JSON
     * (ResourceGenerator.generateValueAssignment), and names the project
     * by its API key rather than in the body - as its E2E suites add a
     * domain for a status page domain.
     */
    const sent: SentRequest = await server.request("POST", "/api/domain", {
      data: {
        domain: "sp-domain-1a2b3c4d.example.com",
        isVerified: true,
      },
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(table.inserts).toHaveLength(1);
    expect(storedName(table.inserts[0]!["domain"])).toBe(
      "sp-domain-1a2b3c4d.example.com",
    );
    expect(table.inserts[0]!["isVerified"]).toBe(true);
    expect(String(table.inserts[0]!["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("Terraform's request for a real domain, verified at once, is refused: it is verified after it is added", async () => {
    const sent: SentRequest = await server.request("POST", "/api/domain", {
      data: { domain: "customer.com", isVerified: true },
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal:
        "Domain cannot be verified during creation. Please verify the domain after creation. Please set isVerified to false.",
    });
    expect(table.inserts).toHaveLength(0);
  });
});

/*
 * Every form a domain legitimately arrives in, with the name it is stored
 * under: trimmed and lower-cased, as before.
 */
const ACCEPTED: Array<[string, unknown, string]> = [
  [
    "text, as Settings > Domains, Terraform and scripts send it",
    "customer.com",
    "customer.com",
  ],
  [
    "text with capitals and spaces around it",
    "  Status.Customer.COM  ",
    "status.customer.com",
  ],
  [
    "the JSON of a Domain, as the Dashboard sends it and the API reference documents it",
    { _type: "Domain", value: "customer.com" },
    "customer.com",
  ],
  [
    "the JSON of a Domain with capitals",
    { _type: "Domain", value: "Status.Customer.COM" },
    "status.customer.com",
  ],
];

/*
 * Values that name no domain, and what the server says to each: a value of
 * another kind is told what to send; a name that is not one is told it is
 * not in a valid format, as before; nothing is told about classes.
 */
const REFUSED: Array<[string, unknown, string]> = [
  ["a number", 42, DOMAIN_NAME_REFUSAL_MESSAGE],
  ["true", true, DOMAIN_NAME_REFUSAL_MESSAGE],
  ["false", false, DOMAIN_NAME_REFUSAL_MESSAGE],
  ["a list of names", ["customer.com"], DOMAIN_NAME_REFUSAL_MESSAGE],
  ["an object", { host: "customer.com" }, DOMAIN_NAME_REFUSAL_MESSAGE],
  [
    "the JSON of another type",
    { _type: "Email", value: "ada@customer.com" },
    DOMAIN_NAME_REFUSAL_MESSAGE,
  ],
  [
    "text that is not a domain name",
    "not a domain",
    "Domain not a domain is not in valid format.",
  ],
  [
    "the JSON of a Domain whose name is not one",
    { _type: "Domain", value: "not a domain" },
    "Domain not a domain is not in valid format.",
  ],
];

describe.each(ACCEPTED)(
  "POST /api/domain with the domain as %s",
  (_form: string, value: unknown, stored: string) => {
    test(`adds it, stored as ${stored}, with a verification text`, async () => {
      const sent: SentRequest = await postDomain(value);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(table.inserts).toHaveLength(1);
      expect(storedName(table.inserts[0]!["domain"])).toBe(stored);
      expect(String(table.inserts[0]!["domainVerificationText"])).toMatch(
        VERIFICATION_TEXT,
      );
    });
  },
);

describe.each(REFUSED)(
  "POST /api/domain with the domain as %s",
  (_form: string, value: unknown, message: string) => {
    test("is refused, saying what to send, and nothing is added", async () => {
      const sent: SentRequest = await postDomain(value);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: message,
      });
      expect(table.inserts).toHaveLength(0);
    });
  },
);

describe("POST /api/domain with no domain", () => {
  test.each([
    ["left out", undefined],
    ["null", null],
    ["empty", ""],
  ])(
    "%s is refused, and nothing is added",
    async (_case: string, value: unknown) => {
      const sent: SentRequest =
        value === undefined
          ? await server.request("POST", "/api/domain", {
              data: { projectId: PROJECT_ID.toString() },
              miscDataProps: {},
            })
          : await postDomain(value);

      expect(sent.status).toBe(400);
      expect(refusalOf(sent)).not.toBe("");
      expect(refusalOf(sent)).not.toContain("instance of Domain");
      expect(table.inserts).toHaveLength(0);
    },
  );
});

describe("PUT /api/domain/:id: renaming a domain takes the same forms", () => {
  beforeEach(() => {
    table.rows.push({
      _id: DOMAIN_ID,
      projectId: PROJECT_ID.toString(),
      domain: new DomainType("old-name.com"),
      slug: "old-name-com",
      isVerified: true,
      domainVerificationText: "oneuptime-verification-abcdefghij0123456789",
      version: 1,
    });
  });

  test.each(ACCEPTED)(
    "%s renames it, and the rename takes its verification away",
    async (_form: string, value: unknown, stored: string) => {
      const sent: SentRequest = await renameDomain(value);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(table.updates).toHaveLength(1);
      expect(storedName(table.updates[0]!.set["domain"])).toBe(stored);
      expect(table.updates[0]!.set["isVerified"]).toBe(false);
    },
  );

  test.each(REFUSED)(
    "%s is refused, saying what to send, and nothing is written",
    async (_form: string, value: unknown, message: string) => {
      const sent: SentRequest = await renameDomain(value);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 400,
        refusal: message,
      });
      expect(table.updates).toHaveLength(0);
    },
  );
});
