import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import BaseAPI from "../../../Server/API/BaseAPI";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../Server/Services/CodeRepositoryService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSmtpConfigService, {
  PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
  Service as ProjectSmtpConfigServiceClass,
} from "../../../Server/Services/ProjectSmtpConfigService";
import UserWebhookService, {
  Service as UserWebhookServiceClass,
} from "../../../Server/Services/UserWebhookService";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * A CREATE'S ANSWER CARRIES NONE OF A PROJECT'S STORED CREDENTIALS (#8989).
 *
 * A create hands back the row it saved, each encrypted column on it as it
 * was stored - a ciphertext - and BaseAPI serializes the row whole, without
 * a column read check, into the answer of the POST. A workflow's Create
 * step returns it too, to be kept in the workflow's logs. A project's SMTP
 * credentials and a repository's webhook secret are write-only, and with
 * the server's ENCRYPTION_SECRET a ciphertext is as good as the secret. A
 * webhook's signing secret is its owner's to read, but nobody wrote the
 * ciphertext. So each service takes them off the row it hands back; the
 * senders read them from the database, decrypted, when they send.
 *
 * DatabaseService.create is replaced with one that returns the saved row as
 * the real one does, ciphertext and all; the services' own create is real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const ROW_ID: string = "20000000-0000-4000-8000-000000000002";
const USER_ID: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000003");

// What the row holds, as a ciphertext of each credential would read.
function ciphertextOf(column: string): string {
  return `U2FsdGVkX1+stored+${column}+as+the+database+holds+it`;
}

interface Case {
  name: string;
  route: string;
  modelType: { new (): BaseModel };
  credentials: ReadonlyArray<string>;
  // The row a create saved: credentials as stored, and the rest.
  savedRow: () => BaseModel;
  // What the API is sent.
  body: JSONObject;
  // A column of the rest of the row, still answered.
  kept: [string, string];
  makeApi: () => BaseAPI<BaseModel, DatabaseService<BaseModel>>;
}

const CASES: Array<Case> = [
  {
    name: "a project's SMTP config",
    route: "POST /smtp-config",
    modelType: ProjectSmtpConfig,
    credentials: PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
    savedRow: (): BaseModel => {
      const row: ProjectSmtpConfig = new ProjectSmtpConfig();
      row._id = ROW_ID;
      row.projectId = PROJECT_ID;
      row.name = "Company mail server";
      row.fromEmail = new Email("alerts@example.com");
      row.fromName = "Alerts";

      for (const column of PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS) {
        (row as unknown as Record<string, unknown>)[column] =
          ciphertextOf(column);
      }

      return row;
    },
    body: {
      name: "Company mail server",
      fromEmail: "alerts@example.com",
      fromName: "Alerts",
      password: "the password as typed",
    },
    kept: ["name", "Company mail server"],
    makeApi: (): BaseAPI<BaseModel, DatabaseService<BaseModel>> => {
      return new BaseAPI<ProjectSmtpConfig, ProjectSmtpConfigServiceClass>(
        ProjectSmtpConfig,
        ProjectSmtpConfigService,
      ) as unknown as BaseAPI<BaseModel, DatabaseService<BaseModel>>;
    },
  },
  {
    name: "a code repository",
    route: "POST /code-repository",
    modelType: CodeRepository,
    credentials: ["secretToken"],
    savedRow: (): BaseModel => {
      const row: CodeRepository = new CodeRepository();
      row._id = ROW_ID;
      row.projectId = PROJECT_ID;
      row.name = "example/service";
      row.secretToken = ciphertextOf("secretToken");
      return row;
    },
    body: { name: "example/service", secretToken: "the secret as typed" },
    kept: ["name", "example/service"],
    makeApi: (): BaseAPI<BaseModel, DatabaseService<BaseModel>> => {
      return new BaseAPI<CodeRepository, CodeRepositoryServiceClass>(
        CodeRepository,
        CodeRepositoryService,
      ) as unknown as BaseAPI<BaseModel, DatabaseService<BaseModel>>;
    },
  },
  {
    name: "a webhook notification method",
    route: "POST /user-webhook",
    modelType: UserWebhook,
    credentials: ["secret"],
    savedRow: (): BaseModel => {
      const row: UserWebhook = new UserWebhook();
      row._id = ROW_ID;
      row.projectId = PROJECT_ID;
      row.userId = USER_ID;
      row.name = "My endpoint";
      row.webhookUrl = "https://hooks.example.com/oneuptime";
      row.secret = ciphertextOf("secret");
      return row;
    },
    body: {
      name: "My endpoint",
      webhookUrl: "https://hooks.example.com/oneuptime",
      secret: "the secret as typed",
    },
    kept: ["webhookUrl", "https://hooks.example.com/oneuptime"],
    makeApi: (): BaseAPI<BaseModel, DatabaseService<BaseModel>> => {
      return new BaseAPI<UserWebhook, UserWebhookServiceClass>(
        UserWebhook,
        UserWebhookService,
      ) as unknown as BaseAPI<BaseModel, DatabaseService<BaseModel>>;
    },
  },
];

function expectNoCredentials(json: JSONObject, testCase: Case): void {
  const text: string = JSON.stringify(json);

  for (const column of testCase.credentials) {
    expect({ column, answered: json[column] }).toEqual({
      column,
      answered: undefined,
    });
    expect(text).not.toContain(ciphertextOf(column));
  }

  expect(text).not.toContain("U2FsdGVkX1");
  expect(text).not.toContain("as typed");

  // The rest of the row is still there.
  expect(json["_id"]).toBe(ROW_ID);
  expect(json[testCase.kept[0]]).toBe(testCase.kept[1]);
}

let current: Case;

beforeEach(() => {
  // With billing on, the request's props carry the project's plan.
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false } as never);

  jest.spyOn(DatabaseService.prototype, "create").mockImplementation((() => {
    return Promise.resolve(current.savedRow());
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe.each(CASES)("$name", (testCase: Case) => {
  beforeEach(() => {
    current = testCase;
  });

  test.each([
    ["a person in the Dashboard", UserType.User],
    ["an API key", UserType.API],
  ])(
    `${testCase.route} answers %s without the credential`,
    async (_label: string, userType: UserType) => {
      const request: OneUptimeRequest = {
        params: {},
        headers: {},
        userType: userType,
        tenantId: PROJECT_ID,
        body: { data: testCase.body },
      } as unknown as OneUptimeRequest;

      await testCase.makeApi().createItem(request, {} as ExpressResponse);

      const sendEntityResponse: jest.Mock =
        Response.sendEntityResponse as unknown as jest.Mock;
      expect(sendEntityResponse).toHaveBeenCalledTimes(1);

      // What Response.sendEntityResponse serializes: every column that is set.
      expectNoCredentials(
        BaseModel.toJSON(
          sendEntityResponse.mock.calls[0]![2] as BaseModel,
          testCase.modelType,
        ),
        testCase,
      );
    },
  );

  function serviceOf(): DatabaseService<BaseModel> {
    return (
      {
        "a project's SMTP config": ProjectSmtpConfigService,
        "a code repository": CodeRepositoryService,
        "a webhook notification method": UserWebhookService,
      } as Record<string, unknown>
    )[testCase.name] as DatabaseService<BaseModel>;
  }

  test("the service's create hands back the row without the credential, to any caller", async () => {
    const data: BaseModel = new testCase.modelType();

    Object.assign(data, testCase.body);

    const created: BaseModel = await serviceOf().create({
      data: data,
      props: { isRoot: true },
    });

    expectNoCredentials(BaseModel.toJSON(created, testCase.modelType), testCase);
  });

  test("a workflow's Create step, where a workflow has one, returns it without the credential", async () => {
    if (!new testCase.modelType().enableWorkflowOn?.create) {
      // No workflow creates one, so no workflow's log could keep it.
      expect(() => {
        return new CreateOneBaseModel<BaseModel>(serviceOf());
      }).toThrow("not found");
      return;
    }

    const component: CreateOneBaseModel<BaseModel> =
      new CreateOneBaseModel<BaseModel>(serviceOf());

    const result: RunReturnType = await component.run(
      { json: testCase.body },
      {
        log: jest.fn() as unknown as RunOptions["log"],
        workflowLogId: ObjectID.generate(),
        workflowId: ObjectID.generate(),
        projectId: PROJECT_ID,
        onError: ((exception: Exception): Exception => {
          return exception;
        }) as RunOptions["onError"],
        executeWorkflow: async (): Promise<void> => {},
      },
    );

    expect(result.executePort?.id).toBe("success");
    expectNoCredentials(result.returnValues["model"] as JSONObject, testCase);
  });
});
