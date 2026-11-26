/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service extends)
 * imports it. Nothing password-related is under test here.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    IsBillingEnabled: false,
  };
});

import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import InfrastructureResourceBinding from "../../../Server/Utils/Monitor/InfrastructureResourceBinding";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { REQUEST_BODY_NOT_JSON_MESSAGE } from "../../../Utils/Monitor/MonitorRequestBody";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * AN API MONITOR'S BODY IS STORED AS WRITTEN, ANY JSON VALUE, AND TEXT NO
 * CHECK COULD SEND IS REFUSED - WHOEVER WRITES IT (#9737).
 *
 * The API, Terraform, a workflow and an AI through the MCP server write a
 * monitor's steps without the form. A body that was not JSON was stored
 * and failed every check, a body sent as a JSON value instead of text was
 * stored as that value, which the probe then sent no body for, and an
 * array - which the probe refused - was stored like any other body.
 *
 * Now any JSON value is stored exactly as it was sent, so the Terraform
 * provider reads back what it wrote, a JSON value is stored as its text,
 * and text that cannot be JSON whatever its placeholders hold is refused
 * on a monitor and on a template. A write of no steps is never refused for
 * a body stored before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const ARRAY_BODY: string = '[{"id": 1}, {"id": 2}]';

// An API monitor's steps, as an API caller sends them, with this body.
const apiSteps: (requestBody: unknown) => JSONObject = (
  requestBody: unknown,
): JSONObject => {
  const step: JSONObject = {
    id: "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
    monitorDestination: {
      _type: "URL",
      value: "https://api.example.com/batch",
    },
    requestType: "POST",
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: {
        monitorCriteriaInstanceArray: [
          {
            _type: "MonitorCriteriaInstance",
            value: {
              id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
              name: "Batch API is offline",
              filterCondition: "Any",
              filters: [
                {
                  checkOn: "Is Online",
                  filterType: "False",
                },
              ],
              incidents: [],
              alerts: [],
            },
          },
        ],
      },
    },
  };

  if (requestBody !== undefined) {
    step["requestBody"] = requestBody as JSONObject;
  }

  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [{ _type: "MonitorStep", value: step }],
      defaultMonitorStatusId: OPERATIONAL_STATUS_ID.toString(),
    },
  };
};

type FindByArgs = {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
};

let storedRows: Array<DatabaseBaseModel> = [];

beforeEach(() => {
  storedRows = [];

  jest
    .spyOn(
      DatabaseService.prototype as unknown as {
        findBy: (args: FindByArgs) => Promise<Array<DatabaseBaseModel>>;
      },
      "findBy",
    )
    .mockImplementation(() => {
      return Promise.resolve(storedRows);
    });

  stubRowsCallerMayWrite(MonitorService, () => {
    return storedRows;
  });
  stubRowsCallerMayWrite(MonitorTemplateService, () => {
    return storedRows;
  });

  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation(async (): Promise<MonitorStatus> => {
      const status: MonitorStatus = new MonitorStatus();
      status.id = OPERATIONAL_STATUS_ID;
      return status;
    });

  jest
    .spyOn(MonitorStatusService, "findDefaultOperationalStatusId")
    .mockResolvedValue(OPERATIONAL_STATUS_ID);

  jest
    .spyOn(MonitorStatusService, "findDefaultOperationalStatusIdOrNull")
    .mockResolvedValue(OPERATIONAL_STATUS_ID);

  // Reference ownership is pinned by its own suite.
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);

  // An infrastructure step's resource binding is pinned by its own suite.
  jest
    .spyOn(InfrastructureResourceBinding, "bindMonitorSteps")
    .mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createMonitor(data: {
  monitorType?: MonitorType;
  requestBody: unknown;
  // As an API caller's body is read: parsed. A workflow may hand JSON.
  asJSON?: boolean;
}): Promise<OnCreate<Monitor>> {
  const monitor: Monitor = new Monitor();
  monitor.name = "Batch API";
  monitor.monitorType = data.monitorType || MonitorType.API;
  monitor.monitorSteps = data.asJSON
    ? (apiSteps(data.requestBody) as unknown as MonitorSteps)
    : MonitorSteps.fromJSON(apiSteps(data.requestBody));

  return await (
    MonitorService as unknown as {
      onBeforeCreate: (c: CreateBy<Monitor>) => Promise<OnCreate<Monitor>>;
    }
  ).onBeforeCreate({ data: monitor, props: { tenantId: PROJECT_ID } });
}

async function updateMonitor(data: {
  write: Record<string, unknown>;
  storedRequestBody: unknown;
}): Promise<OnUpdate<Monitor>> {
  const row: Monitor = new Monitor();
  row.id = MONITOR_ID;
  row.projectId = PROJECT_ID;
  row.monitorType = MonitorType.API;
  row.monitorSteps = MonitorSteps.fromJSON(apiSteps(data.storedRequestBody));
  storedRows = [row];

  const updateBy: UpdateBy<Monitor> = {
    query: { _id: MONITOR_ID.toString() } as never,
    data: data.write as never,
    limit: 1,
    skip: 0,
    props: { tenantId: PROJECT_ID },
  };

  return await (
    MonitorService as unknown as {
      onBeforeUpdate: (u: UpdateBy<Monitor>) => Promise<OnUpdate<Monitor>>;
    }
  ).onBeforeUpdate(updateBy);
}

async function createTemplate(
  requestBody: unknown,
): Promise<OnCreate<MonitorTemplate>> {
  const template: MonitorTemplate = new MonitorTemplate();
  template.templateName = "Batch API";
  template.monitorType = MonitorType.API;
  template.monitorSteps = MonitorSteps.fromJSON(apiSteps(requestBody));

  return await (
    MonitorTemplateService as unknown as {
      onBeforeCreate: (
        c: CreateBy<MonitorTemplate>,
      ) => Promise<OnCreate<MonitorTemplate>>;
    }
  ).onBeforeCreate({ data: template, props: { tenantId: PROJECT_ID } });
}

// The body the write leaves stored: the steps as the database is handed them.
function storedBody(monitorSteps: unknown): unknown {
  const stored: JSONObject = MonitorSteps.fromJSON(
    monitorSteps as MonitorSteps | JSONObject,
  ).toJSON();
  const step: JSONObject = (
    (stored["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;

  return step["requestBody"];
}

describe("an API monitor written through the API keeps any JSON value as its body", () => {
  test.each([
    { name: "an array (the issue's body)", body: ARRAY_BODY },
    { name: "an object", body: '{"check": "deep"}' },
    { name: "a single value", body: '"ping"' },
    { name: "a number", body: "42" },
    { name: "null", body: "null" },
    { name: "JSON5", body: "[{id: 1,},]" },
    {
      name: "a placeholder standing for a number",
      body: '{"count": {{monitorSecrets.Count}}}',
    },
  ])(
    "on create: $name, stored exactly as sent",
    async ({ body }: { name: string; body: string }) => {
      const result: OnCreate<Monitor> = await createMonitor({
        requestBody: body,
      });

      expect(storedBody(result.createBy.data.monitorSteps)).toBe(body);
    },
  );

  test("on create: steps handed as JSON are stored the same", async () => {
    const result: OnCreate<Monitor> = await createMonitor({
      requestBody: ARRAY_BODY,
      asJSON: true,
    });

    expect(storedBody(result.createBy.data.monitorSteps)).toBe(ARRAY_BODY);
  });

  test("on create: a body sent as a JSON value is stored as its JSON", async () => {
    const result: OnCreate<Monitor> = await createMonitor({
      requestBody: [{ id: 1 }, { id: 2 }],
      asJSON: true,
    });

    expect(storedBody(result.createBy.data.monitorSteps)).toBe(
      JSON.stringify([{ id: 1 }, { id: 2 }], null, 2),
    );
  });

  test("on create: no body is stored as none", async () => {
    const result: OnCreate<Monitor> = await createMonitor({
      requestBody: undefined,
    });

    expect(storedBody(result.createBy.data.monitorSteps)).toBeUndefined();
  });

  test("on update: an array body", async () => {
    const result: OnUpdate<Monitor> = await updateMonitor({
      write: { monitorSteps: MonitorSteps.fromJSON(apiSteps(ARRAY_BODY)) },
      storedRequestBody: '{"check": "deep"}',
    });

    expect(storedBody(result.updateBy.data.monitorSteps)).toBe(ARRAY_BODY);
  });
});

describe("an API monitor written through the API is refused a body no check could send", () => {
  test.each([
    { name: "plain text", body: "ping" },
    { name: "XML", body: "<ping><id>1</id></ping>" },
    { name: "form fields as text", body: "a=1&b=2" },
    { name: "an unclosed array", body: '[{"id": 1}' },
  ])("on create: $name", async ({ body }: { name: string; body: string }) => {
    const write: Promise<OnCreate<Monitor>> = createMonitor({
      requestBody: body,
    });

    await expect(write).rejects.toThrow(BadDataException);
    await expect(write).rejects.toThrow(REQUEST_BODY_NOT_JSON_MESSAGE);
  });

  test("on create: steps handed as JSON are refused the same", async () => {
    await expect(
      createMonitor({ requestBody: "<ping/>", asJSON: true }),
    ).rejects.toThrow(REQUEST_BODY_NOT_JSON_MESSAGE);
  });

  test("on update: steps sent with such a body", async () => {
    await expect(
      updateMonitor({
        write: { monitorSteps: MonitorSteps.fromJSON(apiSteps("<ping/>")) },
        storedRequestBody: ARRAY_BODY,
      }),
    ).rejects.toThrow(REQUEST_BODY_NOT_JSON_MESSAGE);
  });

  test("on update: a write of no steps is never refused for a body stored before", async () => {
    await expect(
      updateMonitor({
        write: { name: "Batch API (EU)" },
        storedRequestBody: "<ping/>",
      }),
    ).resolves.toBeDefined();
  });

  test("a monitor of a type that sends no body is never refused for one it kept", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.Website,
        requestBody: "<ping/>",
      }),
    ).resolves.toBeDefined();
  });

  test("a template is refused such a body too, and keeps an array", async () => {
    await expect(createTemplate("<ping/>")).rejects.toThrow(
      REQUEST_BODY_NOT_JSON_MESSAGE,
    );

    const result: OnCreate<MonitorTemplate> = await createTemplate(ARRAY_BODY);

    expect(storedBody(result.createBy.data.monitorSteps)).toBe(ARRAY_BODY);
    expect(
      MonitorSteps.fromJSON(
        result.createBy.data.monitorSteps as unknown as JSONObject,
      ).data!.monitorStepsInstanceArray.map(
        (step: MonitorStep): string | undefined => {
          return step.data?.requestBody;
        },
      ),
    ).toEqual([ARRAY_BODY]);
  });
});
