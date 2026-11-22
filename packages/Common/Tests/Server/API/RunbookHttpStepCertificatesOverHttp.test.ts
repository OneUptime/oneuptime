/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

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

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import RunbookLabelRuleEngineService from "../../../Server/Services/RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "../../../Server/Services/RunbookOwnerRuleEngineService";
import RunbookService from "../../../Server/Services/RunbookService";
import {
  ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE,
  CA_CERTIFICATE_SAVE_MESSAGES,
} from "../../../Server/Utils/Runbook/HttpStepCaCertificate";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CaCertificateProblem } from "../../../Types/Runbook/HttpStepCertificates";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  TestCertificates,
  generateTestCertificates,
  removeTestCertificates,
} from "../TestingUtils/SelfSignedHttpsFixture";
import { getJestSpyOn } from "../../Spy";
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

/*
 * AN HTTP REQUEST STEP'S CERTIFICATE SETTINGS, THROUGH THE API (issue
 * #10277).
 *
 * The API and Terraform write a runbook's steps as JSON, and an HTTP request
 * step's config now holds allowSelfSignedCertificates and caCertificate.
 * Through Express, BaseAPI, the permission layer, RunbookService's hooks and
 * a table in memory:
 *
 *   - a create keeps both as they were sent, a read answers them back, and
 *     an update that turns the switch off and changes the CA certificate
 *     writes exactly that;
 *   - a save whose switch is not true or false, or whose CA certificate is
 *     not one or holds a private key, is refused with a 400 that names the
 *     step and says what to send instead, and nothing is written;
 *   - a CA certificate that is one runbook variable alone (#10441) is kept
 *     as it was sent, whether or not the variable exists yet, and one that
 *     names a variable beside other text is refused with a 400.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10277000-0000-4000-8000-000000000001",
);

const RUNBOOK_ADMIN: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.RunbookAdmin],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

let server: DashboardRequestsOverHttp;
let runbooks: InMemoryTable;
let certificates: TestCertificates;

function httpStep(
  id: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: `Call ${id}`,
    config: {
      url: `https://${id}.internal.example/health`,
      method: "GET",
      ...config,
    },
    continueOnFailure: false,
    requireApprovalBeforeRunning: false,
  };
}

function stepsSent(): Array<Record<string, unknown>> {
  return [
    httpStep("self-signed", { allowSelfSignedCertificates: true }),
    httpStep("private-ca", { caCertificate: certificates.caCertificate }),
    httpStep("public", {}),
  ];
}

// The steps the table holds for the one runbook written.
function storedSteps(): Array<RunbookStep> {
  expect(runbooks.rows).toHaveLength(1);

  return runbooks.rows[0]!["steps"] as Array<RunbookStep>;
}

function configOf(
  steps: Array<RunbookStep> | Array<JSONObject>,
  id: string,
): Record<string, unknown> {
  const found: RunbookStep | JSONObject | undefined = (
    steps as Array<RunbookStep | JSONObject>
  ).find((step: RunbookStep | JSONObject): boolean => {
    return (step as { id?: unknown }).id === id;
  });

  return ((found as { config?: unknown } | undefined)?.config || {}) as Record<
    string,
    unknown
  >;
}

async function create(
  steps: Array<Record<string, unknown>>,
): Promise<SentRequest> {
  return await server.request("POST", "/api/runbook", {
    data: {
      name: "Fail over the billing database",
      projectId: PROJECT_ID.toString(),
      steps,
    },
  });
}

// The words of a refusal, as the server answers them.
function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

beforeAll(async () => {
  certificates = generateTestCertificates("private-ca.internal.example");
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<Runbook, DatabaseService<BaseModel>>(
      Runbook,
      RunbookService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
  removeTestCertificates(certificates);
});

beforeEach(() => {
  server.requests.length = 0;
  stubProjectDirectory({});

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return { ...RUNBOOK_ADMIN };
    });

  getJestSpyOn(
    RunbookLabelRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    RunbookOwnerRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);

  runbooks = useInMemoryTable(RunbookService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a runbook whose HTTP request steps check certificates their own way", () => {
  test("is created with both settings as they were sent", async () => {
    const sent: SentRequest = await create(stepsSent());

    expect(sent.status).toBe(200);

    const steps: Array<RunbookStep> = storedSteps();

    expect(configOf(steps, "self-signed")["allowSelfSignedCertificates"]).toBe(
      true,
    );
    expect(configOf(steps, "self-signed")).not.toHaveProperty("caCertificate");
    expect(configOf(steps, "private-ca")["caCertificate"]).toBe(
      certificates.caCertificate,
    );
    expect(configOf(steps, "private-ca")).not.toHaveProperty(
      "allowSelfSignedCertificates",
    );
    expect(configOf(steps, "public")).toEqual({
      url: "https://public.internal.example/health",
      method: "GET",
    });
  });

  test("is read back with them", async () => {
    await create(stepsSent());
    const id: string = String(runbooks.rows[0]!["_id"]);

    const read: SentRequest = await server.request(
      "POST",
      `/api/runbook/${id}/get-item`,
      { select: { steps: true } },
    );

    expect(read.status).toBe(200);

    const steps: Array<JSONObject> = (read.answer as JSONObject)[
      "steps"
    ] as Array<JSONObject>;

    expect(steps).toEqual(stepsSent());
  });

  test("is updated to exactly what an update sends: the switch off, another CA certificate", async () => {
    await create(stepsSent());
    const id: string = String(runbooks.rows[0]!["_id"]);

    const updated: Array<Record<string, unknown>> = [
      httpStep("self-signed", {}),
      httpStep("private-ca", {
        caCertificate: certificates.selfSigned.certificate,
      }),
      httpStep("public", { allowSelfSignedCertificates: false }),
    ];

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/runbook/${id}`,
      { data: { steps: updated } },
    );

    expect(sent.status).toBe(200);

    const steps: Array<RunbookStep> = storedSteps();

    expect(configOf(steps, "self-signed")).not.toHaveProperty(
      "allowSelfSignedCertificates",
    );
    expect(configOf(steps, "private-ca")["caCertificate"]).toBe(
      certificates.selfSigned.certificate,
    );
    expect(configOf(steps, "public")["allowSelfSignedCertificates"]).toBe(
      false,
    );
  });
});

describe("a runbook whose HTTP request steps keep their CA certificate in a runbook variable", () => {
  function variableSteps(): Array<Record<string, unknown>> {
    return [
      httpStep("billing", {
        caCertificate: "{{global.variables.INTERNAL_CA}}",
      }),
      httpStep("ledger", {
        caCertificate: "\n  {{local.variables.LAB_CA}}\n",
      }),
      // Not used while the switch is on, so not asked to exist either.
      httpStep("lab-switch", {
        allowSelfSignedCertificates: true,
        caCertificate: "{{global.variables.GONE}}",
      }),
    ];
  }

  test("is created with each reference as it was sent, though no such variable exists yet", async () => {
    const sent: SentRequest = await create(variableSteps());

    expect(sent.status).toBe(200);

    const steps: Array<RunbookStep> = storedSteps();

    expect(configOf(steps, "billing")["caCertificate"]).toBe(
      "{{global.variables.INTERNAL_CA}}",
    );
    expect(configOf(steps, "ledger")["caCertificate"]).toBe(
      "\n  {{local.variables.LAB_CA}}\n",
    );
    expect(configOf(steps, "lab-switch")).toEqual({
      url: "https://lab-switch.internal.example/health",
      method: "GET",
      allowSelfSignedCertificates: true,
      caCertificate: "{{global.variables.GONE}}",
    });
  });

  test("is read back with them", async () => {
    await create(variableSteps());
    const id: string = String(runbooks.rows[0]!["_id"]);

    const read: SentRequest = await server.request(
      "POST",
      `/api/runbook/${id}/get-item`,
      { select: { steps: true } },
    );

    expect(read.status).toBe(200);
    expect((read.answer as JSONObject)["steps"]).toEqual(variableSteps());
  });

  test("is updated from a certificate pasted in to the variable that holds it", async () => {
    await create(stepsSent());
    const id: string = String(runbooks.rows[0]!["_id"]);

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/runbook/${id}`,
      {
        data: {
          steps: [
            httpStep("private-ca", {
              caCertificate: "{{global.variables.INTERNAL_CA}}",
            }),
          ],
        },
      },
    );

    expect(sent.status).toBe(200);
    expect(configOf(storedSteps(), "private-ca")["caCertificate"]).toBe(
      "{{global.variables.INTERNAL_CA}}",
    );
  });
});

describe("a save whose settings a step cannot run with", () => {
  test.each([
    [
      "the switch written as the string 'true'",
      { allowSelfSignedCertificates: "true" },
      ALLOW_SELF_SIGNED_CERTIFICATES_NOT_TRUE_OR_FALSE_MESSAGE,
    ],
    [
      "a CA certificate that is not one",
      { caCertificate: "my-ca" },
      CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.NotACertificate],
    ],
  ])(
    "is refused on create with %s, naming the step, and nothing is written",
    async (_what: string, config: Record<string, unknown>, message: string) => {
      const sent: SentRequest = await create([httpStep("billing", config)]);

      expect(sent.status).toBe(400);
      expect(refusalOf(sent)).toBe(`The step "Call billing" ${message}`);
      expect(runbooks.inserts).toEqual([]);
    },
  );

  test.each([
    [
      "beside a certificate",
      (): string => {
        return `${certificates.caCertificate}\n{{global.variables.INTERNAL_CA}}`;
      },
    ],
    [
      "beside another variable",
      (): string => {
        return "{{global.variables.INTERNAL_CA}} {{local.variables.LAB_CA}}";
      },
    ],
  ])(
    "is refused on create with a CA certificate that names a variable %s, naming the step, and nothing is written",
    async (_what: string, caCertificate: () => string) => {
      const sent: SentRequest = await create([
        httpStep("billing", { caCertificate: caCertificate() }),
      ]);

      expect(sent.status).toBe(400);
      expect(refusalOf(sent)).toBe(
        `The step "Call billing" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.VariableAmongText]}`,
      );
      expect(runbooks.inserts).toEqual([]);
    },
  );

  test("is refused on update with a CA certificate that names a variable beside other text, and the runbook keeps its steps", async () => {
    await create(stepsSent());
    const id: string = String(runbooks.rows[0]!["_id"]);

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/runbook/${id}`,
      {
        data: {
          steps: [
            httpStep("private-ca", {
              caCertificate: "use {{global.variables.INTERNAL_CA}}",
            }),
          ],
        },
      },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(
      `The step "Call private-ca" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.VariableAmongText]}`,
    );
    expect(runbooks.updates).toEqual([]);
    expect(configOf(storedSteps(), "private-ca")["caCertificate"]).toBe(
      certificates.caCertificate,
    );
  });

  test("is refused on update with a private key as its CA certificate, and the runbook keeps its steps", async () => {
    await create(stepsSent());
    const id: string = String(runbooks.rows[0]!["_id"]);

    const sent: SentRequest = await server.request(
      "PUT",
      `/api/runbook/${id}`,
      {
        data: {
          steps: [
            httpStep("private-ca", {
              caCertificate: certificates.caSigned.key,
            }),
          ],
        },
      },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(
      `The step "Call private-ca" ${CA_CERTIFICATE_SAVE_MESSAGES[CaCertificateProblem.PrivateKey]}`,
    );
    expect(runbooks.updates).toEqual([]);
    expect(configOf(storedSteps(), "private-ca")["caCertificate"]).toBe(
      certificates.caCertificate,
    );
  });
});
